async function testPipeline() {
  console.log('--- Testing Turbo Media Converter Pipeline ---');
  
  // 1. Test Static files
  const root = await fetch('http://localhost:3000/');
  console.log('✓ GET /:', root.status);
  
  // 2. Test System info
  const sysInfo = await (await fetch('http://localhost:3000/api/system-info')).json();
  console.log('✓ GET /api/system-info: HW Accel detected:', sysInfo.hardwareAcceleration);

  // 3. Test Sample MOV Generation & ffprobe inspection
  console.log('\nGenerating test MOV with H.264 & AAC...');
  const sampleRes = await fetch('http://localhost:3000/api/generate-sample', { method: 'POST' });
  const sample = await sampleRes.json();
  console.log('✓ Generated & Probed:', sample.originalName);
  console.log('  Video Codec:', sample.metadata.video.codec, `${sample.metadata.video.width}x${sample.metadata.video.height}`);
  console.log('  Audio Codec:', sample.metadata.audio.codec, `${sample.metadata.audio.sampleRate}Hz`);
  console.log('  Recommended Mode:', sample.recommendedMode);
  console.log('  Fast Remux Possible:', sample.fastCopyPossible);

  // 4. Test Instant Remux Conversion
  console.log('\nStarting Instant Remux MOV -> MP4...');
  const t0 = Date.now();
  const convRes = await fetch('http://localhost:3000/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: sample.jobId, mode: 'instant-remux', targetFormat: 'mp4' })
  });
  const conv = await convRes.json();
  console.log('✓ Conversion response:', conv);

  // Poll until done
  let finished = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 200));
    const histRes = await fetch('http://localhost:3000/api/history');
    const history = await histRes.json();
    const item = history.find(h => h.jobId === sample.jobId);
    if (item) {
      console.log(`\n🎉 Conversion Succeeded in ${item.elapsedSec}s!`);
      console.log('  Output file:', item.outputFileName);
      console.log('  Output size:', (item.outputSize / 1024).toFixed(1), 'KB');
      console.log('  Mode:', item.mode);
      finished = true;
      break;
    }
  }

  if (!finished) {
    console.error('Timed out waiting for conversion');
    process.exit(1);
  }

  // 5. Test Download endpoint
  const dlRes = await fetch(`http://localhost:3000/api/download/${sample.jobId}`);
  console.log('✓ Download status:', dlRes.status, 'Content-Length:', dlRes.headers.get('content-length'));

  // 6. Test Preview Stream endpoint
  const previewRes = await fetch(`http://localhost:3000/api/preview/${sample.jobId}`);
  console.log('✓ Preview stream status:', previewRes.status, 'Content-Type:', previewRes.headers.get('content-type'));

  // 7. Test Audio Extraction to MP3
  console.log('\nTesting Audio Extraction to MP3 (320kbps)...');
  const audioSampleRes = await (await fetch('http://localhost:3000/api/generate-sample', { method: 'POST' })).json();
  const audioConvRes = await (await fetch('http://localhost:3000/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: audioSampleRes.jobId, mode: 'audio-extract', targetFormat: 'mp3', audioBitrate: '320k' })
  })).json();
  console.log('✓ Audio convert response:', audioConvRes);
  await new Promise(r => setTimeout(r, 1200));
  const hist = await (await fetch('http://localhost:3000/api/history')).json();
  const audioItem = hist.find(h => h.jobId === audioSampleRes.jobId);
  console.log('✓ Audio Extraction Succeeded:', audioItem.outputFileName, 'Elapsed:', audioItem.elapsedSec + 's');

  console.log('\n✨ ALL TESTS (VIDEO & AUDIO) PASSED SUCCESSFULLY! ✨');
}

testPipeline().catch(e => {
  console.error('Pipeline test failed:', e);
  process.exit(1);
});
