import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const NOTES_FILE = join(PROJECT_ROOT, 'data', 'notes.json');

export interface Note {
  id: string;
  title: string;
  description?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface NotesData {
  notes: Note[];
}

const DEFAULT_DATA: NotesData = {
  notes: [],
};

let cachedData: NotesData | null = null;

async function loadNotes(): Promise<NotesData> {
  if (cachedData) {
    return cachedData;
  }

  try {
    const content = await readFile(NOTES_FILE, 'utf-8');
    cachedData = JSON.parse(content) as NotesData;
    return cachedData;
  } catch {
    return DEFAULT_DATA;
  }
}

async function saveNotes(data: NotesData): Promise<void> {
  await mkdir(dirname(NOTES_FILE), { recursive: true });
  await writeFile(NOTES_FILE, JSON.stringify(data, null, 2));
  cachedData = data;
}

function generateId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export async function getNotes(): Promise<Note[]> {
  const data = await loadNotes();
  return data.notes;
}

export async function getNote(id: string): Promise<Note | null> {
  const data = await loadNotes();
  return data.notes.find(n => n.id === id) || null;
}

export async function createNote(input: { title: string; description?: string; body: string }): Promise<Note> {
  const data = await loadNotes();
  const now = new Date().toISOString();

  const note: Note = {
    id: generateId(),
    title: input.title,
    description: input.description,
    body: input.body,
    createdAt: now,
    updatedAt: now,
  };

  data.notes.unshift(note); // Add to beginning
  await saveNotes(data);
  return note;
}

export async function updateNote(id: string, input: { title?: string; description?: string; body?: string }): Promise<Note | null> {
  const data = await loadNotes();
  const index = data.notes.findIndex(n => n.id === id);

  if (index === -1) {
    return null;
  }

  const note = data.notes[index];
  const updated: Note = {
    ...note,
    ...(input.title !== undefined && { title: input.title }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.body !== undefined && { body: input.body }),
    updatedAt: new Date().toISOString(),
  };

  data.notes[index] = updated;
  await saveNotes(data);
  return updated;
}

export async function deleteNote(id: string): Promise<boolean> {
  const data = await loadNotes();
  const index = data.notes.findIndex(n => n.id === id);

  if (index === -1) {
    return false;
  }

  data.notes.splice(index, 1);
  await saveNotes(data);
  return true;
}
