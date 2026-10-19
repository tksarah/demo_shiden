import fs from 'node:fs/promises';
import {fabricMaskSVG} from '../dist/idle-fabric.js';
for(const kind of ['hair','cape'])await fs.writeFile(new URL(`../dist/assets/magi-${kind}-drift.svg`,import.meta.url),fabricMaskSVG(kind)+'\n');
