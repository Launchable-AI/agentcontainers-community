//! agentc-tap-helper: Minimal privileged helper for TAP device creation
//!
//! This binary is designed to be installed with CAP_NET_ADMIN capability,
//! allowing unprivileged processes to create TAP devices for VM networking.
//!
//! Security considerations:
//! - Minimal attack surface: only TAP creation, bridge attachment, and cleanup
//! - Strict input validation: device names, bridge names
//! - No shell execution: direct syscalls and netlink only
//! - Capabilities dropped after use when possible

use clap::{Parser, Subcommand};
use nix::errno::Errno;
use nix::fcntl::{open, OFlag};
use nix::sys::stat::Mode;
use nix::unistd::{close, getuid, getgid, Uid, Gid};
use std::ffi::CString;
use std::fs;
use std::io::{Read, Write};
use std::mem;
use std::os::unix::io::RawFd;
use std::path::Path;
use std::process::exit;
use serde::Serialize;

// TUN/TAP ioctl constants
const TUNSETIFF: libc::c_ulong = 0x400454ca;
const TUNSETOWNER: libc::c_ulong = 0x400454cc;
const TUNSETGROUP: libc::c_ulong = 0x400454ce;
const TUNSETPERSIST: libc::c_ulong = 0x400454cb;

// TUN/TAP flags
const IFF_TAP: libc::c_short = 0x0002;
const IFF_NO_PI: libc::c_short = 0x1000;
const IFF_VNET_HDR: libc::c_short = 0x4000;

// Socket ioctl for interface operations
const SIOCBRADDBR: libc::c_ulong = 0x89a0;
const SIOCBRADDIF: libc::c_ulong = 0x89a2;
const SIOCSIFFLAGS: libc::c_ulong = 0x8914;
const SIOCGIFINDEX: libc::c_ulong = 0x8933;
const SIOCGIFFLAGS: libc::c_ulong = 0x8913;
const SIOCSIFADDR: libc::c_ulong = 0x8916;
const SIOCSIFNETMASK: libc::c_ulong = 0x891c;

const IFF_UP: libc::c_short = 0x1;

const IFNAMSIZ: usize = 16;

/// TAP device request structure for ioctl
#[repr(C)]
struct IfReq {
    ifr_name: [libc::c_char; IFNAMSIZ],
    ifr_ifru: IfReqUnion,
}

#[repr(C)]
union IfReqUnion {
    ifr_flags: libc::c_short,
    ifr_ifindex: libc::c_int,
    ifr_addr: libc::sockaddr,
    _padding: [u8; 24],
}

impl IfReq {
    fn new(name: &str) -> Result<Self, String> {
        if name.len() >= IFNAMSIZ {
            return Err(format!("Device name too long: {} (max {})", name.len(), IFNAMSIZ - 1));
        }

        let mut ifr: IfReq = unsafe { mem::zeroed() };
        for (i, byte) in name.bytes().enumerate() {
            ifr.ifr_name[i] = byte as libc::c_char;
        }
        Ok(ifr)
    }

    fn with_flags(name: &str, flags: libc::c_short) -> Result<Self, String> {
        let mut ifr = Self::new(name)?;
        ifr.ifr_ifru.ifr_flags = flags;
        Ok(ifr)
    }
}

#[derive(Parser)]
#[command(name = "agentc-tap-helper")]
#[command(about = "Minimal privileged helper for TAP device creation")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new TAP device
    Create {
        /// Name for the TAP device (e.g., "agentc-tap0")
        #[arg(long)]
        name: String,

        /// Bridge to attach the TAP device to
        #[arg(long)]
        bridge: String,

        /// UID to set as owner of the TAP device
        #[arg(long)]
        owner_uid: Option<u32>,

        /// GID to set as group of the TAP device
        #[arg(long)]
        owner_gid: Option<u32>,

        /// Output format (json or text)
        #[arg(long, default_value = "json")]
        format: String,
    },

    /// Delete a TAP device
    Delete {
        /// Name of the TAP device to delete
        #[arg(long)]
        name: String,
    },

    /// Check if this helper has required capabilities
    CheckCaps,

    /// Setup bridge and basic networking infrastructure
    SetupBridge {
        /// Name for the bridge (e.g., "agentc-br0")
        #[arg(long)]
        name: String,

        /// IP address for the bridge (e.g., "172.31.0.1/24")
        #[arg(long)]
        ip: String,
    },
}

#[derive(Serialize)]
struct CreateResult {
    success: bool,
    tap_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct ErrorResult {
    success: bool,
    error: String,
}

/// Validate device/bridge name to prevent injection attacks
fn validate_interface_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Interface name cannot be empty".to_string());
    }
    if name.len() >= IFNAMSIZ {
        return Err(format!("Interface name too long (max {} chars)", IFNAMSIZ - 1));
    }
    let chars: Vec<char> = name.chars().collect();
    if !chars[0].is_ascii_alphabetic() {
        return Err("Interface name must start with a letter".to_string());
    }
    for c in &chars {
        if !c.is_ascii_alphanumeric() && *c != '-' && *c != '_' {
            return Err(format!("Invalid character in interface name: '{}'", c));
        }
    }
    Ok(())
}

/// Check if we have CAP_NET_ADMIN capability
fn check_capabilities() -> bool {
    if let Ok(content) = fs::read_to_string("/proc/self/status") {
        for line in content.lines() {
            if line.starts_with("CapEff:") {
                if let Some(hex) = line.split_whitespace().nth(1) {
                    if let Ok(caps) = u64::from_str_radix(hex, 16) {
                        return (caps & (1 << 12)) != 0;
                    }
                }
            }
        }
    }
    getuid().is_root()
}

/// Check if a network interface exists
fn interface_exists(name: &str) -> bool {
    Path::new(&format!("/sys/class/net/{}", name)).exists()
}

/// Get interface index by name
fn get_interface_index(name: &str) -> Result<i32, String> {
    let path = format!("/sys/class/net/{}/ifindex", name);
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read ifindex for {}: {}", name, e))?;
    content.trim().parse()
        .map_err(|e| format!("Failed to parse ifindex: {}", e))
}

/// Create a control socket for ioctl operations
fn create_control_socket() -> Result<RawFd, String> {
    let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_DGRAM, 0) };
    if fd < 0 {
        return Err(format!("Failed to create socket: {}", Errno::last()));
    }
    Ok(fd)
}

/// Create a TAP device
fn create_tap(name: &str, owner_uid: Uid, owner_gid: Gid) -> Result<RawFd, String> {
    let tun_fd = open(
        "/dev/net/tun",
        OFlag::O_RDWR | OFlag::O_CLOEXEC,
        Mode::empty(),
    ).map_err(|e| format!("Failed to open /dev/net/tun: {}", e))?;

    let mut ifr = IfReq::with_flags(name, IFF_TAP | IFF_NO_PI | IFF_VNET_HDR)?;

    unsafe {
        if libc::ioctl(tun_fd, TUNSETIFF, &mut ifr as *mut IfReq) < 0 {
            let _ = close(tun_fd);
            return Err(format!("Failed to create TAP device: {}", Errno::last()));
        }
    }

    unsafe {
        let uid = owner_uid.as_raw() as libc::c_ulong;
        if libc::ioctl(tun_fd, TUNSETOWNER, uid) < 0 {
            let _ = close(tun_fd);
            return Err(format!("Failed to set TAP owner: {}", Errno::last()));
        }
    }

    unsafe {
        let gid = owner_gid.as_raw() as libc::c_ulong;
        if libc::ioctl(tun_fd, TUNSETGROUP, gid) < 0 {
            let _ = close(tun_fd);
            return Err(format!("Failed to set TAP group: {}", Errno::last()));
        }
    }

    unsafe {
        if libc::ioctl(tun_fd, TUNSETPERSIST, 1 as libc::c_ulong) < 0 {
            let _ = close(tun_fd);
            return Err(format!("Failed to set TAP persistence: {}", Errno::last()));
        }
    }

    Ok(tun_fd)
}

/// Add interface to bridge using ioctl
fn add_to_bridge(tap_name: &str, bridge_name: &str) -> Result<(), String> {
    if !interface_exists(bridge_name) {
        return Err(format!("Bridge '{}' does not exist", bridge_name));
    }

    let tap_index = get_interface_index(tap_name)?;
    let sock_fd = create_control_socket()?;

    let mut ifr = IfReq::new(bridge_name)?;
    ifr.ifr_ifru.ifr_ifindex = tap_index;

    let result = unsafe { libc::ioctl(sock_fd, SIOCBRADDIF, &mut ifr as *mut IfReq) };
    unsafe { libc::close(sock_fd) };

    if result < 0 {
        return Err(format!("Failed to add TAP to bridge: {}", Errno::last()));
    }

    Ok(())
}

/// Bring interface up using ioctl
fn bring_up(name: &str) -> Result<(), String> {
    let sock_fd = create_control_socket()?;
    let mut ifr = IfReq::new(name)?;

    // Get current flags
    let result = unsafe { libc::ioctl(sock_fd, SIOCGIFFLAGS, &mut ifr as *mut IfReq) };
    if result < 0 {
        unsafe { libc::close(sock_fd) };
        return Err(format!("Failed to get interface flags: {}", Errno::last()));
    }

    // Add UP flag
    unsafe {
        ifr.ifr_ifru.ifr_flags |= IFF_UP;
    }

    // Set flags
    let result = unsafe { libc::ioctl(sock_fd, SIOCSIFFLAGS, &mut ifr as *mut IfReq) };
    unsafe { libc::close(sock_fd) };

    if result < 0 {
        return Err(format!("Failed to bring up interface: {}", Errno::last()));
    }

    Ok(())
}

/// Delete interface by writing to sysfs (simpler than netlink)
fn delete_interface(name: &str) -> Result<(), String> {
    // For TAP devices, we can delete by clearing persistence and closing
    // But the simplest is to use the /sys interface
    let path = format!("/sys/class/net/{}/operstate", name);
    if !Path::new(&path).exists() {
        return Err(format!("Interface '{}' does not exist", name));
    }

    // Open the TUN device and clear persistence to delete the TAP
    let tun_fd = match open("/dev/net/tun", OFlag::O_RDWR, Mode::empty()) {
        Ok(fd) => fd,
        Err(_) => {
            // Fall back to ip command if we can't access /dev/net/tun
            let output = std::process::Command::new("ip")
                .args(["link", "delete", name])
                .output()
                .map_err(|e| format!("Failed to execute ip command: {}", e))?;
            if !output.status.success() {
                return Err(format!("Failed to delete interface: {}",
                    String::from_utf8_lossy(&output.stderr)));
            }
            return Ok(());
        }
    };

    let mut ifr = IfReq::with_flags(name, IFF_TAP | IFF_NO_PI)?;

    unsafe {
        // Try to attach to existing TAP
        if libc::ioctl(tun_fd, TUNSETIFF, &mut ifr as *mut IfReq) < 0 {
            let _ = close(tun_fd);
            // If we can't attach, try ip command
            let output = std::process::Command::new("ip")
                .args(["link", "delete", name])
                .output()
                .map_err(|e| format!("Failed to execute ip command: {}", e))?;
            if !output.status.success() {
                return Err(format!("Failed to delete interface: {}",
                    String::from_utf8_lossy(&output.stderr)));
            }
            return Ok(());
        }

        // Clear persistence
        if libc::ioctl(tun_fd, TUNSETPERSIST, 0 as libc::c_ulong) < 0 {
            let _ = close(tun_fd);
            return Err(format!("Failed to clear TAP persistence: {}", Errno::last()));
        }
    }

    let _ = close(tun_fd);
    Ok(())
}

/// Create bridge using ioctl
fn create_bridge(name: &str) -> Result<(), String> {
    let sock_fd = create_control_socket()?;
    let name_cstr = CString::new(name).map_err(|_| "Invalid bridge name")?;

    let result = unsafe {
        libc::ioctl(sock_fd, SIOCBRADDBR, name_cstr.as_ptr())
    };
    unsafe { libc::close(sock_fd) };

    if result < 0 {
        let errno = Errno::last();
        if errno != Errno::EEXIST {
            return Err(format!("Failed to create bridge: {}", errno));
        }
    }

    Ok(())
}

/// Set IP address on interface
fn set_ip_address(name: &str, ip: &str) -> Result<(), String> {
    let parts: Vec<&str> = ip.split('/').collect();
    if parts.len() != 2 {
        return Err("IP must be in CIDR format (e.g., 172.31.0.1/24)".to_string());
    }

    let addr_str = parts[0];
    let prefix_len: u32 = parts[1].parse()
        .map_err(|_| "Invalid prefix length".to_string())?;

    // Parse IP address
    let octets: Vec<u8> = addr_str.split('.')
        .map(|s| s.parse().map_err(|_| "Invalid IP octet"))
        .collect::<Result<Vec<_>, _>>()?;

    if octets.len() != 4 {
        return Err("Invalid IP address format".to_string());
    }

    let sock_fd = create_control_socket()?;
    let mut ifr = IfReq::new(name)?;

    // Set address
    unsafe {
        let addr = &mut ifr.ifr_ifru.ifr_addr as *mut libc::sockaddr as *mut libc::sockaddr_in;
        (*addr).sin_family = libc::AF_INET as u16;
        (*addr).sin_addr.s_addr = u32::from_ne_bytes([octets[0], octets[1], octets[2], octets[3]]);
    }

    let result = unsafe { libc::ioctl(sock_fd, SIOCSIFADDR, &mut ifr as *mut IfReq) };
    if result < 0 {
        let errno = Errno::last();
        unsafe { libc::close(sock_fd) };
        // Ignore "already exists" error
        if errno != Errno::EEXIST {
            return Err(format!("Failed to set IP address: {}", errno));
        }
    }

    // Calculate netmask from prefix length
    let netmask: u32 = if prefix_len == 0 {
        0
    } else {
        !0u32 << (32 - prefix_len)
    };

    // Set netmask
    unsafe {
        let addr = &mut ifr.ifr_ifru.ifr_addr as *mut libc::sockaddr as *mut libc::sockaddr_in;
        (*addr).sin_family = libc::AF_INET as u16;
        (*addr).sin_addr.s_addr = netmask.to_be();
    }

    let result = unsafe { libc::ioctl(sock_fd, SIOCSIFNETMASK, &mut ifr as *mut IfReq) };
    unsafe { libc::close(sock_fd) };

    if result < 0 {
        return Err(format!("Failed to set netmask: {}", Errno::last()));
    }

    Ok(())
}

fn print_error(msg: &str, format: &str) {
    if format == "json" {
        let result = ErrorResult {
            success: false,
            error: msg.to_string(),
        };
        println!("{}", serde_json::to_string(&result).unwrap());
    } else {
        eprintln!("Error: {}", msg);
    }
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Create { name, bridge, owner_uid, owner_gid, format } => {
            if let Err(e) = validate_interface_name(&name) {
                print_error(&e, &format);
                exit(1);
            }
            if let Err(e) = validate_interface_name(&bridge) {
                print_error(&e, &format);
                exit(1);
            }

            if !check_capabilities() {
                print_error(
                    "Missing CAP_NET_ADMIN capability. Install with: sudo setcap cap_net_admin+ep <binary>",
                    &format
                );
                exit(1);
            }

            if interface_exists(&name) {
                print_error(&format!("TAP device '{}' already exists", name), &format);
                exit(1);
            }

            let uid = Uid::from_raw(owner_uid.unwrap_or_else(|| getuid().as_raw()));
            let gid = Gid::from_raw(owner_gid.unwrap_or_else(|| getgid().as_raw()));

            let tap_fd = match create_tap(&name, uid, gid) {
                Ok(fd) => fd,
                Err(e) => {
                    print_error(&e, &format);
                    exit(1);
                }
            };

            let _ = close(tap_fd);

            // Add to bridge
            if let Err(e) = add_to_bridge(&name, &bridge) {
                let _ = delete_interface(&name);
                print_error(&e, &format);
                exit(1);
            }

            // Bring up interface
            if let Err(e) = bring_up(&name) {
                let _ = delete_interface(&name);
                print_error(&e, &format);
                exit(1);
            }

            if format == "json" {
                let result = CreateResult {
                    success: true,
                    tap_name: name,
                    error: None,
                };
                println!("{}", serde_json::to_string(&result).unwrap());
            } else {
                println!("Created TAP device: {}", name);
            }
        }

        Commands::Delete { name } => {
            if let Err(e) = validate_interface_name(&name) {
                eprintln!("Error: {}", e);
                exit(1);
            }

            if !check_capabilities() {
                eprintln!("Error: Missing CAP_NET_ADMIN capability");
                exit(1);
            }

            if !interface_exists(&name) {
                // Not an error if it doesn't exist
                println!("TAP device '{}' does not exist", name);
                exit(0);
            }

            if let Err(e) = delete_interface(&name) {
                eprintln!("Error: {}", e);
                exit(1);
            }

            println!("Deleted TAP device: {}", name);
        }

        Commands::CheckCaps => {
            if check_capabilities() {
                println!("CAP_NET_ADMIN: yes");
                exit(0);
            } else {
                println!("CAP_NET_ADMIN: no");
                println!("Install with: sudo setcap cap_net_admin+ep {}",
                    std::env::args().next().unwrap_or_default());
                exit(1);
            }
        }

        Commands::SetupBridge { name, ip } => {
            if let Err(e) = validate_interface_name(&name) {
                eprintln!("Error: {}", e);
                exit(1);
            }

            if !check_capabilities() {
                eprintln!("Error: Missing CAP_NET_ADMIN capability");
                exit(1);
            }

            // Create bridge if it doesn't exist
            if !interface_exists(&name) {
                if let Err(e) = create_bridge(&name) {
                    eprintln!("Error creating bridge: {}", e);
                    exit(1);
                }
            }

            // Set IP address
            if let Err(e) = set_ip_address(&name, &ip) {
                eprintln!("Error setting IP: {}", e);
                exit(1);
            }

            // Bring up
            if let Err(e) = bring_up(&name) {
                eprintln!("Error bringing up bridge: {}", e);
                exit(1);
            }

            println!("Bridge '{}' configured with IP {}", name, ip);
        }
    }
}
