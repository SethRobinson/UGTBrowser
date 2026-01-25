// build.js
// Simple build script to bundle ES modules for Chrome extension

const fs = require('fs');
const path = require('path');

// Build background script
async function buildBackground() {
  console.log('Building background script...');
  
  // For background, we'll use ES modules directly since service workers support them
  // Just copy the main.js file and update manifest to point to it
  
  const srcDir = path.join(__dirname, 'src', 'background');
  const distDir = path.join(__dirname, 'dist-build');
  
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  
  // For now, background uses ES modules which service workers support
  console.log('Background script ready (uses ES modules)');
}

// Build content script (would require bundler for ES modules)
async function buildContent() {
  console.log('Building content script...');
  
  // Content scripts don't support ES modules natively
  // For now, the original contentScript.js will be used
  // In a production setup, use a bundler like esbuild or rollup
  
  console.log('Content script: using original contentScript.js');
  console.log('Note: For full ES module support, use a bundler like esbuild');
}

// Main build function
async function build() {
  console.log('Starting build...\n');
  
  await buildBackground();
  await buildContent();
  
  console.log('\nBuild complete!');
  console.log('\nManifest should point to:');
  console.log('- Background: src/background/main.js (ES module)');
  console.log('- Content: contentScript.js (original, or bundle if using a bundler)');
}

build().catch(console.error);
