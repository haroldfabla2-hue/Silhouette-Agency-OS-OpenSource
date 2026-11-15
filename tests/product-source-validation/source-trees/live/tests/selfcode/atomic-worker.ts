import { atomicWriteFile } from '../../services/selfdev/atomicWrite';
const [destination, size] = process.argv.slice(2);
atomicWriteFile(destination, Buffer.alloc(Number(size), 0x4e));
