import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import * as dockerService from '../services/docker.js';
import { CreateVolumeSchema } from '../types/index.js';

const volumes = new Hono();

// List all volumes
volumes.get('/', async (c) => {
  const list = await dockerService.listVolumes();
  return c.json(list);
});

// Create volume
volumes.post('/', zValidator('json', CreateVolumeSchema), async (c) => {
  const { name } = c.req.valid('json');

  try {
    await dockerService.createVolume(name);
    return c.json({ success: true, name }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Delete volume
volumes.delete('/:name', async (c) => {
  const name = c.req.param('name');

  try {
    await dockerService.removeVolume(name);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get volume size (lazy loaded)
volumes.get('/:name/size', async (c) => {
  const name = c.req.param('name');

  try {
    const size = await dockerService.getVolumeSize(name);
    return c.json({ size });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// List files in volume
volumes.get('/:name/files', async (c) => {
  const name = c.req.param('name');

  try {
    const files = await dockerService.getVolumeFiles(name);
    return c.json({ files });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Upload file to volume
volumes.post('/:name/upload', async (c) => {
  const volumeName = c.req.param('name');

  try {
    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await dockerService.uploadFileToVolume(volumeName, file.name, buffer);

    return c.json({ success: true, fileName: file.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Upload directory to volume
volumes.post('/:name/upload-directory', async (c) => {
  const volumeName = c.req.param('name');

  try {
    const formData = await c.req.formData();
    const files = formData.getAll('files');
    const paths = formData.getAll('paths');

    if (!files || files.length === 0) {
      return c.json({ error: 'No files provided' }, 400);
    }

    if (files.length !== paths.length) {
      return c.json({ error: 'Mismatched files and paths count' }, 400);
    }

    let uploadedCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = paths[i];

      if (!(file instanceof File) || typeof relativePath !== 'string') {
        continue;
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Use the relative path to preserve directory structure
      await dockerService.uploadFileToVolume(volumeName, relativePath, buffer);
      uploadedCount++;
    }

    return c.json({ success: true, filesUploaded: uploadedCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

export default volumes;
