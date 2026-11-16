// Authored fixture modes only. No submitted JavaScript or real vm runner executed.
const fs = require('node:fs');
const mode = process.env.OWNED_TEST_MODE;
if (mode === 'close-stdin') { fs.closeSync(0); setTimeout(() => {}, 1000); }
else if (mode === 'hang' || mode === 'ignore-term') {
    if (mode === 'ignore-term') process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
} else if (mode === 'flood') {
    process.on('SIGTERM', () => {});
    setInterval(() => { process.stdout.write('x'.repeat(8192)); process.stderr.write('x'.repeat(8192)); }, 1);
} else if (mode === 'held-stdio') {
    const { spawn } = require('node:child_process');
    const helper = spawn(process.execPath, ['-e', 'setTimeout(()=>{},1000)'], { stdio: ['ignore', 1, 2] });
    fs.writeFileSync(process.env.OWNED_HELPER_PID_FILE, String(helper.pid));
    process.exit(0);
} else {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (mode === 'echo-payload') process.stdout.write(JSON.stringify({success:true,result:payload}));
    else if (mode === 'invalid') process.stdout.write('not JSON fixture');
    else if (mode === 'signal') process.kill(process.pid, 'SIGTERM');
    else if (mode === 'longlogs') process.stdout.write(JSON.stringify({success:true,result:payload.args,logs:['é'.repeat(10000)]}));
    else if (mode === 'longerror') process.stdout.write(JSON.stringify({success:false,error:'é'.repeat(10000)}));
    else if (mode === 'error') process.stdout.write(JSON.stringify({ success:false,error:'authored execution detail',logs:['before failure'] }));
    else if (mode === 'singlelog') process.stdout.write(JSON.stringify({success:true,result:payload.args,logs:['native CLI visible']}));
    else if (mode === 'logs') process.stdout.write(JSON.stringify({ success:true,result:payload.args,logs:['visible fixture log',42,...Array(70).fill('next')] }));
    else process.stdout.write(JSON.stringify({ success: true, result: payload.args.result }));
    if (mode === 'nonzero') process.exitCode = 7;
}
