import {rm,mkdir,copyFile,cp} from 'node:fs/promises';
// Publish only explicit frontend assets. Never expose lib/, ops/, tests/ or secrets.
await rm('public',{recursive:true,force:true});await mkdir('public',{recursive:true});
for(const name of ['index.html','app.js','styles.css','sw.js','manifest.webmanifest'])await copyFile(name,`public/${name}`);
await cp('icons','public/icons',{recursive:true});
console.log('Public assets built. Server API functions remain in api/.');
