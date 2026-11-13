import { readFile } from 'node:fs/promises'
import { nextReleaseVersion } from './release-version.mjs'
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
console.log(nextReleaseVersion(pkg.version))
