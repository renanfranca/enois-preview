process.stdout.write('locked\n');
await new Promise<void>(resolve=>{process.stdin.once('data',()=>resolve());process.stdin.once('end',()=>resolve());process.stdin.resume();});
process.stdin.pause();
export {};
