const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { exec } = require('child_process');
const { probeFile, convertFile, detectHardwareEncoders } = require('./converter');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CONVERTED_DIR = path.join(__dirname, 'converted');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(CONVERTED_DIR)) fs.mkdirSync(CONVERTED_DIR, { recursive: true });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10 GB limit
});

// In-memory state
const activeJobs = new Map();
const jobHistory = [];

/**
 * Endpoint: Generate synthetic sample MOV file for instant speed testing
 */
app.post('/api/generate-sample', async (req, res) => {
  const sampleName = `sample_${Date.now()}.mov`;
  const samplePath = path.join(UPLOADS_DIR, sampleName);
  
  // Create a 6-second 1080p MOV with H.264 video and AAC audio
  const cmd = `ffmpeg -y -f lavfi -i testsrc=duration=6:size=1920x1080:rate=30 -f lavfi -i sine=frequency=1000:duration=6 -c:v libx264 -preset ultrafast -c:a aac -pix_fmt yuv420p "${samplePath}"`;

  exec(cmd, async (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to create sample MOV: ' + err.message });
    }

    try {
      const metadata = await probeFile(samplePath);
      metadata.originalName = sampleName;
      const jobId = path.basename(sampleName, path.extname(sampleName));

      const job = {
        jobId,
        originalName: sampleName,
        inputPath: samplePath,
        status: 'probed',
        metadata,
        progress: { percent: 0, speed: '0x', elapsedSec: 0, etaSec: 0 },
        createdAt: Date.now()
      };

      activeJobs.set(jobId, job);

      res.json({
        jobId,
        originalName: sampleName,
        metadata,
        recommendedMode: metadata.recommendedStrategy,
        fastCopyPossible: metadata.fastCopyPossible,
        explanation: metadata.explanation
      });
    } catch (probeErr) {
      res.status(500).json({ error: 'Failed to probe sample: ' + probeErr.message });
    }
  });
});

/**
 * Endpoint: System Information & HW Acceleration
 */
app.get('/api/system-info', (req, res) => {
  const hw = detectHardwareEncoders();
  res.json({
    hardwareAcceleration: hw,
    serverPlatform: process.platform,
    version: '1.0.0'
  });
});

/**
 * Endpoint: Upload media file & probe metadata
 */
app.post('/api/upload', upload.single('mediaFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No media file provided.' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname;
  const jobId = path.basename(req.file.filename, path.extname(req.file.filename));

  try {
    const metadata = await probeFile(filePath);
    metadata.originalName = originalName;

    const job = {
      jobId,
      originalName,
      inputPath: filePath,
      status: 'probed',
      metadata,
      progress: { percent: 0, speed: '0x', elapsedSec: 0, etaSec: 0 },
      createdAt: Date.now()
    };

    activeJobs.set(jobId, job);

    res.json({
      jobId,
      originalName,
      metadata,
      recommendedMode: metadata.recommendedStrategy,
      fastCopyPossible: metadata.fastCopyPossible,
      explanation: metadata.explanation
    });
  } catch (err) {
    console.error('Probe failed:', err);
    try { fs.unlinkSync(filePath); } catch (e) {}
    res.status(500).json({ error: `Failed to analyze media file: ${err.message}` });
  }
});

/**
 * Endpoint: Probe a direct local file path (for zero-copy instant local conversion)
 */
app.post('/api/probe-path', async (req, res) => {
  const { filePath } = req.body;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Valid local file path is required.' });
  }

  const jobId = 'local-' + Date.now() + '-' + Math.round(Math.random() * 1E6);

  try {
    const metadata = await probeFile(filePath);
    const originalName = path.basename(filePath);
    metadata.originalName = originalName;

    const job = {
      jobId,
      originalName,
      inputPath: filePath,
      isLocalDirect: true,
      status: 'probed',
      metadata,
      progress: { percent: 0, speed: '0x', elapsedSec: 0, etaSec: 0 },
      createdAt: Date.now()
    };

    activeJobs.set(jobId, job);

    res.json({
      jobId,
      originalName,
      metadata,
      recommendedMode: metadata.recommendedStrategy,
      fastCopyPossible: metadata.fastCopyPossible,
      explanation: metadata.explanation
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to analyze local file: ${err.message}` });
  }
});

/**
 * Endpoint: Start Conversion
 */
app.post('/api/convert', (req, res) => {
  const {
    jobId,
    mode = 'instant-remux',
    targetFormat = 'mp4',
    resolution = 'original',
    crf = 22,
    preset = 'ultrafast',
    audioBitrate = '192k',
    startTime,
    endTime,
    hardwareAccel = true
  } = req.body;

  const job = activeJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found. Please upload again.' });
  }

  if (job.status === 'converting') {
    return res.status(400).json({ error: 'Conversion already in progress for this job.' });
  }

  // Create clean output name
  const originalBaseName = path.basename(job.originalName, path.extname(job.originalName));
  const outputFileName = `${originalBaseName}_converted.${targetFormat.toLowerCase()}`;
  const outputPath = path.join(CONVERTED_DIR, `${jobId}_${outputFileName}`);

  job.status = 'converting';
  job.outputPath = outputPath;
  job.outputFileName = outputFileName;
  job.options = {
    mode,
    targetFormat,
    resolution,
    crf,
    preset,
    audioBitrate,
    startTime,
    endTime,
    hardwareAccel
  };

  const conversionEmitter = convertFile(job.inputPath, outputPath, job.options, job.metadata);
  job.emitter = conversionEmitter;

  conversionEmitter.on('progress', data => {
    job.progress = data;
    if (job.sseClient) {
      job.sseClient.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
    }
  });

  conversionEmitter.on('done', result => {
    job.status = 'completed';
    job.result = result;
    job.completedAt = Date.now();

    const historyEntry = {
      jobId,
      originalName: job.originalName,
      outputFileName,
      inputSize: job.metadata.fileSize,
      outputSize: result.outputSize,
      elapsedSec: result.elapsedSec,
      mode,
      targetFormat,
      completedAt: new Date().toLocaleTimeString()
    };
    jobHistory.unshift(historyEntry);
    if (jobHistory.length > 30) jobHistory.pop();

    if (job.sseClient) {
      job.sseClient.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
      job.sseClient.end();
    }
  });

  conversionEmitter.on('error', err => {
    job.status = 'error';
    job.error = err.message;
    console.error(`Conversion error for job ${jobId}:`, err);

    if (job.sseClient) {
      job.sseClient.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      job.sseClient.end();
    }
  });

  res.json({
    message: 'Conversion started',
    jobId,
    mode,
    targetFormat
  });
});

/**
 * Endpoint: Server-Sent Events (SSE) for Real-Time Live Progress
 */
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current progress immediately
  res.write(`event: progress\ndata: ${JSON.stringify(job.progress)}\n\n`);

  if (job.status === 'completed' && job.result) {
    res.write(`event: done\ndata: ${JSON.stringify(job.result)}\n\n`);
    return res.end();
  }

  if (job.status === 'error') {
    res.write(`event: error\ndata: ${JSON.stringify({ error: job.error })}\n\n`);
    return res.end();
  }

  job.sseClient = res;

  req.on('close', () => {
    if (job.sseClient === res) {
      job.sseClient = null;
    }
  });
});

/**
 * Endpoint: Download converted file
 */
app.get('/api/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);

  if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'File not found or conversion not completed.' });
  }

  res.download(job.outputPath, job.outputFileName);
});

/**
 * Endpoint: Preview/Stream converted or input media in browser
 */
app.get('/api/preview/:jobId', (req, res) => {
  const { jobId } = req.params;
  const type = req.query.type || 'output'; // 'input' or 'output'
  const job = activeJobs.get(jobId);

  if (!job) return res.status(404).send('Job not found');

  const targetPath = type === 'input' ? job.inputPath : job.outputPath;
  if (!targetPath || !fs.existsSync(targetPath)) {
    return res.status(404).send('Media file not found');
  }

  const stat = fs.statSync(targetPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const ext = path.extname(targetPath).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(targetPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    };
    res.writeHead(200, head);
    fs.createReadStream(targetPath).pipe(res);
  }
});

/**
 * Endpoint: Reveal in Windows Explorer
 */
app.post('/api/open-folder', (req, res) => {
  const { jobId } = req.body;
  const job = activeJobs.get(jobId);

  if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const safePath = path.resolve(job.outputPath).replace(/\//g, '\\');
  // Run explorer /select,"path" on Windows
  exec(`explorer.exe /select,"${safePath}"`, err => {
    if (err) {
      console.error('Failed to open explorer:', err);
      return res.status(500).json({ error: 'Could not open folder in Explorer' });
    }
    res.json({ success: true, path: safePath });
  });
});

/**
 * Endpoint: History
 */
app.get('/api/history', (req, res) => {
  res.json(jobHistory);
});

// Start Server with auto-fallback if port is busy
function startServer(portToTry) {
  const server = app.listen(portToTry, () => {
    console.log(`\n======================================================`);
    console.log(`⚡ Turbo Media Converter is running at:`);
    console.log(`   👉 http://localhost:${portToTry}`);
    console.log(`   Direct MOV to MP4: Instant Remux (< 1s, Lossless)`);
    console.log(`======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  Port ${portToTry} is currently in use. Trying port ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(PORT);

