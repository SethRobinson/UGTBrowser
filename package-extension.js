const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Read manifest to get version
const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
const extensionName = manifest.name.replace(/\s+/g, '-'); // Replace spaces for filename

// Define output file
const outputDir = path.join(__dirname, 'dist');
if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir);
}
const outputFilePath = path.join(outputDir, `${extensionName}-v${version}.zip`);
const output = fs.createWriteStream(outputFilePath);
const archive = archiver('zip', {
  zlib: { level: 9 } // Sets the compression level.
});

// Listen for all archive data to be written
// 'close' event is fired only when a file descriptor is involved
output.on('close', function() {
  console.log(archive.pointer() + ' total bytes');
  console.log('Archiver has been finalized and the output file descriptor has closed.');
  console.log(`Package created at: ${outputFilePath}`);
});

// This event is fired when the data source is drained no matter what was the data source.
// It is not part of this library but rather from the NodeJS Stream API.
// @see: https://nodejs.org/api/stream.html#stream_event_end
output.on('end', function() {
  console.log('Data has been drained');
});

// Good practice to catch warnings (ie stat failures and other non-blocking errors)
archive.on('warning', function(err) {
  if (err.code === 'ENOENT') {
    console.warn('Warning:', err);
  } else {
    throw err;
  }
});

// Good practice to catch this error explicitly
archive.on('error', function(err) {
  throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// List of files/directories to include in the zip
// Add all essential extension files here
const filesToInclude = [
  'manifest.json',
  'background.js',
  'contentScript.js',
  'options.html',
  'options.js',
  'options.css',
  'icon256.png',
  'icon48.png',
  'icon128.png',
  'privacy_policy.md',
  'LICENSE',
  'README.md'
  // Add any other files or folders like 'images/', 'lib/', etc.
];

filesToInclude.forEach(fileOrDir => {
  const fullPath = path.join(__dirname, fileOrDir);
  if (fs.existsSync(fullPath)) {
    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      archive.directory(fullPath, path.basename(fileOrDir));
    } else {
      archive.file(fullPath, { name: path.basename(fileOrDir) });
    }
  } else {
    console.warn(`Warning: File or directory not found and will be skipped: ${fileOrDir}`);
  }
});

// Finalize the archive (ie we are done appending files but streams have to finish yet)
// 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
archive.finalize(); 