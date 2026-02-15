import { TerminalService } from './services/system/terminalService';

const service = TerminalService.getInstance();
const sessionId = 'test-session-1';

console.log('--- Testing Terminal Service ---');

service.on('data', (id, data) => {
    console.log(`[OUTPUT ${id}]:`, data);
});

service.on('close', (id, code) => {
    console.log(`[CLOSE ${id}]:`, code);
    process.exit(0);
});

console.log('Creating session...');
service.createSession(sessionId);

setTimeout(() => {
    console.log('Sending "echo Hello World" command...');
    // Windows might need \r\n, Linux \n. terminalService handles os EOL? 
    // Actually terminalService writes directly. 
    // "echo Hello World" + Enter.
    const enter = process.platform === 'win32' ? '\r\n' : '\n';
    service.write(sessionId, `echo Hello World${enter}`);
}, 1000);

setTimeout(() => {
    console.log('Sending "dir" command...');
    const enter = process.platform === 'win32' ? '\r\n' : '\n';
    const cmd = process.platform === 'win32' ? 'dir' : 'ls';
    service.write(sessionId, `${cmd}${enter}`);
}, 2000);

setTimeout(() => {
    console.log('Killing session...');
    service.kill(sessionId);
}, 4000);
