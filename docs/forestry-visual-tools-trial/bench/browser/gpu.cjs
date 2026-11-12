const { chromium } = require('playwright');
(async () => { for (const args of [['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=swiftshader','--enable-unsafe-swiftshader'], ['--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader','--enable-unsafe-swiftshader']]) {
 const b = await chromium.launch({ args }); const p = await b.newPage(); await p.goto('https://example.com');
 const r = await p.evaluate(async () => { if (!navigator.gpu) return 'no navigator.gpu'; const a = await navigator.gpu.requestAdapter(); if (!a) return 'no adapter'; const info = a.info || {}; const d = await a.requestDevice(); return 'adapter ' + JSON.stringify({vendor:info.vendor, arch:info.architecture, desc:info.description}) + ' device ok, maxBuffer ' + d.limits.maxStorageBufferBindingSize; }).catch(e => 'err ' + e);
 console.log(JSON.stringify(args), r); await b.close(); } })();
