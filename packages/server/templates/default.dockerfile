FROM ubuntu:24.04

# Install packages
RUN apt-get update && apt-get install -y \
    openssh-server \
    sudo \
    curl \
    wget \
    git \
    neovim \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    tmux \
    npm \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd

# Create non-root user with sudo access
RUN useradd -m -s /bin/bash dev \
    && echo 'dev ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Set workdir to ~/workspace
WORKDIR /home/dev/workspace
RUN chown dev:dev /home/dev/workspace

# Install OpenCode
USER dev
RUN curl -fsSL https://opencode.ai/install | bash

# Change back to root
USER root
WORKDIR /

# Configure SSH for key-based auth only
RUN sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config

# Setup SSH key ({{PUBLIC_KEY}} is replaced at build time)
RUN mkdir -p /home/dev/.ssh \
    && chmod 700 /home/dev/.ssh \
    && echo '{{PUBLIC_KEY}}' > /home/dev/.ssh/authorized_keys \
    && chmod 600 /home/dev/.ssh/authorized_keys \
    && chown -R dev:dev /home/dev/.ssh

# Add ~/.local/bin to PATH for pip-installed tools
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/dev/.bashrc

# Set working directory
WORKDIR /home/dev/workspace

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
