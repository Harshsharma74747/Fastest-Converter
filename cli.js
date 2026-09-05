#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { probeFile, convertFile } = require('./converter');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`
⚡ Turbo Media Converter CLI
The fastest way to convert MOV to MP4 (lossless stream remuxing) and media files.

Usage:
  node cli.js <inputFile> [outputFile] [options]

Examples:
  node cli.js video.mov
  node cli.js video.mov converted.mp4
  node cli.js video.mov audio.mp3
  node cli.js video.mp4 output.gif

Options:
  --mode <instant|smart|reencode|audio>  Override conversion strategy
  --format <mp4|mp3|wav|gif|mkv|webm>   Set target format
  --crf <0-51>                          Quality level (default: 22)
  --bitrate <320k|192k|128k>            Audio bitrate (default: 192k)
`);
    process.exit(0);
  }

  const inputFile = path.resolve(args[0]);
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ Error: File "${inputFile}" does not exist.`);
    process.exit(1);
  }

  console.log(`🔍 Probing media file: ${path.basename(inputFile)}...`);
  const metadata = await probeFile(inputFile);

  const isMov = path.extname(inputFile).toLowerCase() === '.mov';
  let targetFormat = 'mp4';
  let outputFile = null;

  // Check if second arg is output file
  if (args[1] && !args[1].startsWith('--')) {
    outputFile = path.resolve(args[1]);
    targetFormat = path.extname(outputFile).slice(1).toLowerCase();
  } else {
    const defaultExt = targetFormat;
    outputFile = path.join(
      path.dirname(inputFile),
      `${path.basename(inputFile, path.extname(inputFile))}_converted.${defaultExt}`
    );
  }

  console.log(`\n📄 Media Information:`);
  console.log(`   - Size: ${(metadata.fileSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`   - Duration: ${metadata.duration.toFixed(2)}s`);
  if (metadata.video) {
    console.log(`   - Video: ${metadata.video.codec.toUpperCase()} (${metadata.video.width}x${metadata.video.height} @ ${metadata.video.fps} fps)`);
  }
  if (metadata.audio) {
    console.log(`   - Audio: ${metadata.audio.codec.toUpperCase()} (${metadata.audio.sampleRate} Hz, ${metadata.audio.channels} ch)`);
  }

  // Determine mode
  let mode = metadata.recommendedStrategy;
  if (args.includes('--mode')) {
    const idx = args.indexOf('--mode');
    if (args[idx + 1]) mode = args[idx + 1];
  }

  console.log(`\n🎯 Selected Strategy: ${mode.toUpperCase()}`);
  console.log(`   ${metadata.explanation}`);
  console.log(`🚀 Starting conversion -> ${path.basename(outputFile)}`);

  const startTime = Date.now();
  const conversion = convertFile(inputFile, outputFile, {
    mode,
    targetFormat
  }, metadata);

  let lastPercent = -1;

  conversion.on('progress', data => {
    if (data.percent !== lastPercent) {
      lastPercent = data.percent;
      const bar = '='.repeat(Math.floor(data.percent / 5)) + ' '.repeat(20 - Math.floor(data.percent / 5));
      process.stdout.write(`\r[${bar}] ${data.percent}% | Speed: ${data.speed} | Elapsed: ${data.elapsedSec}s | ETA: ${data.etaSec}s   `);
    }
  });

  conversion.on('done', res => {
    const totalSec = (Date.now() - startTime) / 1000;
    console.log(`\n\n✅ Conversion completed successfully!`);
    console.log(`   ⏱️ Time taken: ${totalSec.toFixed(2)} seconds`);
    console.log(`   💾 Output size: ${(res.outputSize / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`   📁 Output path: ${res.outputPath}`);
  });

  conversion.on('error', err => {
    console.error(`\n❌ Conversion failed:`, err.message);
    process.exit(1);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
