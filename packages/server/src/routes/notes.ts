import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as notesService from '../services/notes.js';

const notes = new Hono();

const CreateNoteSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  body: z.string().min(1),
});

const UpdateNoteSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  body: z.string().min(1).optional(),
});

// Get all notes
notes.get('/', async (c) => {
  const allNotes = await notesService.getNotes();
  return c.json({ notes: allNotes });
});

// Get a single note
notes.get('/:id', async (c) => {
  const { id } = c.req.param();
  const note = await notesService.getNote(id);

  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  return c.json(note);
});

// Create a note
notes.post('/', zValidator('json', CreateNoteSchema), async (c) => {
  const input = c.req.valid('json');
  const note = await notesService.createNote(input);
  return c.json(note, 201);
});

// Update a note
notes.patch('/:id', zValidator('json', UpdateNoteSchema), async (c) => {
  const { id } = c.req.param();
  const input = c.req.valid('json');
  const note = await notesService.updateNote(id, input);

  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  return c.json(note);
});

// Delete a note
notes.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const deleted = await notesService.deleteNote(id);

  if (!deleted) {
    return c.json({ error: 'Note not found' }, 404);
  }

  return c.json({ success: true });
});

export default notes;
