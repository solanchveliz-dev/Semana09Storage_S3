require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { S3Client, PutObjectCommand, GetObjectCommand,
        DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:8080'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Checksums solo cuando se requieran (evita fallos del PUT prefirmado desde el navegador)
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED'
});

const BUCKET = process.env.S3_BUCKET;
const PREFIX = 'originales/';
const MB = 1024 * 1024;
// Límite en MB por tipo permitido (fotos según la guía; videos como extra)
const LIMITS = {
  'image/jpeg': 5, 'image/png': 5, 'image/webp': 5,
  'video/mp4': 50, 'video/webm': 50, 'video/quicktime': 50
};
const VIDEO_EXT = ['mp4', 'webm', 'mov'];

const displayName = key => key.split('/').pop().replace(/^\d+-[a-f0-9]{12}-/, '');
const typeOf = key => VIDEO_EXT.includes(key.split('.').pop().toLowerCase()) ? 'video' : 'image';

// 1) Presigned URL para subir (5 min)
app.post('/api/upload-url', async (req, res) => {
  try {
    const { filename, contentType, sizeBytes } = req.body || {};
    if (!filename || !contentType || !sizeBytes)
      return res.status(400).json({ error: 'Faltan datos: filename, contentType, sizeBytes' });
    const max = LIMITS[contentType];
    if (!max)
      return res.status(400).json({ error: 'Tipo de archivo no permitido' });
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0)
      return res.status(400).json({ error: 'Tamaño inválido' });
    if (size > max * MB)
      return res.status(400).json({ error: `Archivo demasiado grande (máx ${max} MB)` });

    // Nombre seguro: sin rutas (../) ni caracteres raros
    const safeName = path.basename(String(filename)).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    const key = `${PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;

    const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
    res.json({ uploadUrl, key, expiresIn: 300 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar la URL de subida' });
  }
});

// 2) Listar archivos con URLs de visualización (15 min)
app.get('/api/images', async (req, res) => {
  try {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
    const objs = (list.Contents || []).filter(o => !o.Key.endsWith('/'));
    const items = await Promise.all(objs.map(async o => ({
      key: o.Key,
      name: displayName(o.Key),
      type: typeOf(o.Key),
      size: o.Size,
      lastModified: o.LastModified,
      url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }), { expiresIn: 900 })
    })));
    items.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo listar el bucket' });
  }
});

// 3) Eliminar archivo
app.delete('/api/images/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    if (!key.startsWith(PREFIX) || key.includes('..'))
      return res.status(400).json({ error: 'Key inválida' });
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({ deleted: true, key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));