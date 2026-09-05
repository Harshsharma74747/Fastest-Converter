const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

// Cache detected hardware encoders
let hardwareEncoders = null;

function detectHardwareEncoders() {
  if (hardwareEncoders !== null) return hardwareEncoders;
  
  hardwareEncoders = {
    nvenc: false,
    qsv: false,
    amf: false,
    mediaFoundation: false,
    preferredH264: 'libx264',
    preferredHEVC: 'libx265'
  };

  try {
    const output = execSync('ffmpeg -encoders', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (output.includes('h264_nvenc')) {
      hardwareEncoders.nvenc = true;
      hardwareEncoders.preferredH264 = 'h264_nvenc';
      hardwareEncoders.preferredHEVC = 'hevc_nvenc';
    } else if (output.includes('h264_qsv')) {
      hardwareEncoders.qsv = true;
      hardwareEncoders.preferredH264 = 'h264_qsv';
      hardwareEncoders.preferredHEVC = 'hevc_qsv';
    } else if (output.includes('h264_amf')) {
      hardwareEncoders.amf = true;
      hardwareEncoders.preferredH264 = 'h264_amf';
      hardwareEncoders.preferredHEVC = 'hevc_amf';
    } else if (output.includes('h264_mf')) {
      hardwareEncoders.mediaFoundation = true;
      hardwareEncoders.preferredH264 = 'h264_mf';
    }
  } catch (err) {
    console.error('Error detecting hardware encoders:', err.message);
  }
  return hardwareEncoders;
}

/**
 * Probes media file with ffprobe and returns structured metadata
 */
function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => { stdout += data.toString(); });
    proc.stderr.on('data', data => { stderr += data.toString(); });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`ffprobe failed with code ${code}: ${stderr}`));
      }

      try {
        const metadata = JSON.parse(stdout);
        const format = metadata.format || {};
        const streams = metadata.streams || [];

        const videoStreams = streams.filter(s => s.codec_type === 'video');
        const audioStreams = streams.filter(s => s.codec_type === 'audio');

        const video = videoStreams[0] || null;
        const audio = audioStreams[0] || null;

        const duration = parseFloat(format.duration || (video ? video.duration : 0) || (audio ? audio.duration : 0) || 0);
        const size = parseInt(format.size || 0, 10);
        const bitRate = parseInt(format.bit_rate || 0, 10);

        // Analyze stream copy compatibility for MOV -> MP4
        const videoCodec = video ? video.codec_name.toLowerCase() : null;
        const audioCodec = audio ? audio.codec_name.toLowerCase() : null;

        // MP4 natively supports h264, hevc/h265, mpeg4, av1
        const isVideoMp4Compatible = videoCodec && ['h264', 'hevc', 'h265', 'mpeg4', 'av1'].includes(videoCodec);
        // MP4 audio natively prefers aac, mp3, ac3, eac3, flac, opus
        const isAudioMp4Compatible = !audio || ['aac', 'mp3', 'ac3', 'eac3', 'flac', 'opus'].includes(audioCodec);
        
        let recommendedStrategy = 'custom';
        let fastCopyPossible = false;
        let explanation = '';

        const ext = path.extname(filePath).toLowerCase();

        if (isVideoMp4Compatible && isAudioMp4Compatible) {
          recommendedStrategy = 'instant-remux';
          fastCopyPossible = true;
          explanation = `⚡ Instant Lossless Remux possible! Video is ${videoCodec.toUpperCase()} and audio is ${audioCodec ? audioCodec.toUpperCase() : 'None'}. Converts in < 1 second with 0% quality loss.`;
        } else if (isVideoMp4Compatible && !isAudioMp4Compatible) {
          recommendedStrategy = 'smart-passthrough';
          fastCopyPossible = true;
          explanation = `🚀 Smart Passthrough recommended! Video (${videoCodec.toUpperCase()}) will be copied instantly without re-encoding; audio (${audioCodec ? audioCodec.toUpperCase() : 'Unknown'}) will be converted to universal AAC. Ready in ~1-2 seconds!`;
        } else if (video) {
          recommendedStrategy = 'reencode-fast';
          fastCopyPossible = false;
          explanation = `Video uses ${videoCodec ? videoCodec.toUpperCase() : 'unsupported format'}. Fast hardware-accelerated re-encoding will be used.`;
        } else if (audio) {
          recommendedStrategy = 'audio-convert';
          explanation = `Audio track detected (${audioCodec.toUpperCase()}). Ready for instant audio conversion or extraction.`;
        }

        resolve({
          fileName: path.basename(filePath),
          filePath,
          fileSize: size,
          duration,
          bitRate,
          video: video ? {
            codec: video.codec_name,
            codecLongName: video.codec_long_name,
            width: video.width,
            height: video.height,
            fps: evalFps(video.r_frame_rate || video.avg_frame_rate),
            bitrate: parseInt(video.bit_rate || 0, 10),
            pixelFormat: video.pix_fmt
          } : null,
          audio: audio ? {
            codec: audio.codec_name,
            codecLongName: audio.codec_long_name,
            channels: audio.channels,
            sampleRate: audio.sample_rate,
            bitrate: parseInt(audio.bit_rate || 0, 10)
          } : null,
          hasVideo: !!video,
          hasAudio: !!audio,
          isMov: ext === '.mov',
          fastCopyPossible,
          recommendedStrategy,
          explanation,
          hardwareEncoders: detectHardwareEncoders()
        });
      } catch (parseErr) {
        reject(new Error(`Failed to parse ffprobe output: ${parseErr.message}`));
      }
    });
  });
}

function evalFps(rateStr) {
  if (!rateStr) return 30;
  if (rateStr.includes('/')) {
    const [num, den] = rateStr.split('/').map(Number);
    if (den && den > 0) return Math.round((num / den) * 100) / 100;
  }
  const parsed = parseFloat(rateStr);
  return isNaN(parsed) ? 30 : parsed;
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return parseFloat(timeStr) || 0;
}

/**
 * Builds FFmpeg command line arguments based on options
 */
function buildFfmpegArgs(inputPath, outputPath, options = {}) {
  const args = ['-y']; // Overwrite output file

  // Trim start
  if (options.startTime) {
    args.push('-ss', options.startTime);
  }

  // Input
  args.push('-i', inputPath);

  // Trim duration/to
  if (options.endTime) {
    args.push('-to', options.endTime);
  }

  const mode = options.mode || 'auto';
  const targetFormat = options.targetFormat || 'mp4';
  const hw = detectHardwareEncoders();

  if (mode === 'instant-remux') {
    // ⚡ FASTEST POSSIBLE: Direct Stream Copy (Lossless remuxing)
    args.push('-c', 'copy');
    if (targetFormat === 'mp4' || outputPath.toLowerCase().endsWith('.mp4')) {
      args.push('-movflags', '+faststart');
    }
  } else if (mode === 'smart-passthrough') {
    // 🚀 SMART PASSTHROUGH: Copy video untouched, convert audio to high-quality AAC
    args.push('-c:v', 'copy');
    args.push('-c:a', 'aac', '-b:a', options.audioBitrate || '192k');
    if (targetFormat === 'mp4' || outputPath.toLowerCase().endsWith('.mp4')) {
      args.push('-movflags', '+faststart');
    }
  } else if (mode === 'audio-extract' || targetFormat === 'mp3' || targetFormat === 'wav' || targetFormat === 'aac' || targetFormat === 'flac' || targetFormat === 'm4a') {
    // 🎵 AUDIO EXTRACTION
    args.push('-vn'); // Disable video stream
    const audioFmt = targetFormat.toLowerCase();
    if (audioFmt === 'mp3') {
      args.push('-c:a', 'libmp3lame', '-b:a', options.audioBitrate || '320k');
    } else if (audioFmt === 'wav') {
      args.push('-c:a', 'pcm_s16le');
    } else if (audioFmt === 'flac') {
      args.push('-c:a', 'flac');
    } else if (audioFmt === 'aac' || audioFmt === 'm4a') {
      args.push('-c:a', 'aac', '-b:a', options.audioBitrate || '256k');
    } else if (audioFmt === 'ogg') {
      args.push('-c:a', 'libvorbis', '-q:a', '6');
    } else {
      args.push('-c:a', 'aac', '-b:a', options.audioBitrate || '192k');
    }
  } else if (targetFormat === 'gif') {
    // 🖼️ HIGH-QUALITY GIF
    const fps = options.fps || 15;
    const width = options.width || 480;
    args.push('-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`);
  } else {
    // 🎬 VIDEO RE-ENCODING (Fast or Custom)
    let videoEncoder = 'libx264';
    const useHardware = options.hardwareAccel !== false;

    if (useHardware) {
      if (options.codec === 'hevc' || options.codec === 'h265') {
        videoEncoder = hw.preferredHEVC;
      } else {
        videoEncoder = hw.preferredH264;
      }
    } else {
      videoEncoder = (options.codec === 'hevc' || options.codec === 'h265') ? 'libx265' : 'libx264';
    }

    args.push('-c:v', videoEncoder);

    // Preset & speed
    if (videoEncoder.includes('nvenc')) {
      args.push('-preset', 'p2', '-cq', options.crf ? String(options.crf) : '22');
    } else if (videoEncoder.includes('qsv') || videoEncoder.includes('amf')) {
      args.push('-quality', 'speed');
    } else if (videoEncoder === 'libx264' || videoEncoder === 'libx265') {
      args.push('-preset', options.preset || 'ultrafast');
      args.push('-crf', options.crf ? String(options.crf) : '22');
    }

    // Resolution scaling
    if (options.resolution && options.resolution !== 'original') {
      const heights = { '4k': 2160, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360 };
      const targetHeight = heights[options.resolution];
      if (targetHeight) {
        args.push('-vf', `scale=-2:${targetHeight}`);
      }
    }

    // Audio configuration
    args.push('-c:a', 'aac', '-b:a', options.audioBitrate || '192k');

    if (targetFormat === 'mp4' || outputPath.toLowerCase().endsWith('.mp4')) {
      args.push('-movflags', '+faststart');
    }
  }

  // Output path
  args.push(outputPath);

  return args;
}

/**
 * Runs FFmpeg conversion with real-time EventEmitter progress
 */
function convertFile(inputPath, outputPath, options = {}, metadata = null) {
  const emitter = new EventEmitter();
  const args = buildFfmpegArgs(inputPath, outputPath, options);

  const startTime = Date.now();
  let totalDuration = (metadata && metadata.duration) ? metadata.duration : 0;
  
  // If duration was specified by trim
  if (options.startTime && options.endTime) {
    const s = parseTimeToSeconds(options.startTime);
    const e = parseTimeToSeconds(options.endTime);
    if (e > s) totalDuration = e - s;
  }

  const proc = spawn('ffmpeg', args);
  let stderrBuffer = '';

  proc.stderr.on('data', chunk => {
    const str = chunk.toString();
    stderrBuffer += str;

    // Try extracting total duration if unknown
    if (!totalDuration) {
      const durMatch = str.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (durMatch) {
        const hours = parseInt(durMatch[1], 10);
        const mins = parseInt(durMatch[2], 10);
        const secs = parseInt(durMatch[3], 10);
        const ms = parseInt(durMatch[4], 10) * 10;
        totalDuration = hours * 3600 + mins * 60 + secs + (ms / 1000);
      }
    }

    // Parse progress: frame, fps, time, speed
    const timeMatch = str.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
    const speedMatch = str.match(/speed=\s*([0-9\.]+)x/);
    const fpsMatch = str.match(/fps=\s*([0-9\.]+)/);
    const frameMatch = str.match(/frame=\s*([0-9]+)/);

    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const mins = parseInt(timeMatch[2], 10);
      const secs = parseInt(timeMatch[3], 10);
      const ms = parseInt(timeMatch[4], 10) * 10;
      const currentSeconds = hours * 3600 + mins * 60 + secs + (ms / 1000);

      let percent = 0;
      if (totalDuration > 0) {
        percent = Math.min(100, Math.round((currentSeconds / totalDuration) * 100));
      }

      const speedStr = speedMatch ? `${speedMatch[1]}x` : (options.mode === 'instant-remux' ? '⚡ Instant' : '1x');
      const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 0;
      const frame = frameMatch ? parseInt(frameMatch[1], 10) : 0;
      const elapsedMs = Date.now() - startTime;

      let etaSec = 0;
      if (percent > 0 && percent < 100) {
        const remainingPercent = 100 - percent;
        etaSec = Math.round((elapsedMs / percent) * remainingPercent / 1000);
      }

      emitter.emit('progress', {
        percent,
        currentSeconds,
        totalDuration,
        speed: speedStr,
        fps,
        frame,
        elapsedSec: Math.round(elapsedMs / 1000),
        etaSec,
        mode: options.mode
      });
    }
  });

  proc.on('close', code => {
    const elapsedMs = Date.now() - startTime;
    if (code === 0) {
      // Get output file size
      let outSize = 0;
      try {
        const st = fs.statSync(outputPath);
        outSize = st.size;
      } catch (e) {}

      emitter.emit('done', {
        success: true,
        outputPath,
        outputFileName: path.basename(outputPath),
        outputSize: outSize,
        elapsedMs,
        elapsedSec: (elapsedMs / 1000).toFixed(2),
        mode: options.mode
      });
    } else {
      emitter.emit('error', new Error(`FFmpeg exited with code ${code}. Error log:\n${stderrBuffer.slice(-800)}`));
    }
  });

  proc.on('error', err => {
    emitter.emit('error', err);
  });

  // Attach cancel method
  emitter.cancel = () => {
    try {
      proc.kill('SIGTERM');
    } catch (e) {}
  };

  return emitter;
}

module.exports = {
  detectHardwareEncoders,
  probeFile,
  buildFfmpegArgs,
  convertFile
};
