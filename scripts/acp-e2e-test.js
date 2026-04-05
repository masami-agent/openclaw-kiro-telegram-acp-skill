// ACP bridge e2e test - using --session to target kiro agent
const { spawn } = require('child_process');

// Use --session to target the kiro agent specifically
const child = spawn('openclaw', ['acp', '--session', 'agent:main:main'], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
const responses = new Map();
let updates = [];
let fullText = '';

child.stdout.on('data', (d) => {
  buf += d.toString();
  while (true) {
    const nl = buf.indexOf('\n');
    if (nl === -1) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.id && responses.has(obj.id)) {
        responses.get(obj.id)(obj);
      } else if (obj.method) {
        // Capture ALL notifications
        const update = obj.params?.update || obj.params;
        const kind = update?.sessionUpdate || update?.kind || obj.method;
        updates.push({ kind, data: update, method: obj.method });
        if (kind === 'agent_message_chunk') {
          const text = update?.content?.content?.[0]?.text || '';
          if (text) { fullText += text; process.stderr.write(text); }
        } else {
          process.stderr.write('[' + kind + '] ');
        }
      }
    } catch {}
  }
});
child.stderr.on('data', (d) => {
  const s = d.toString();
  if (s.includes('Error') || s.includes('error')) {
    process.stderr.write('[STDERR] ' + s.trim() + '\n');
  }
});

function send(obj) {
  return new Promise((resolve) => {
    responses.set(obj.id, resolve);
    child.stdin.write(JSON.stringify(obj) + '\n');
  });
}

async function main() {
  await send({jsonrpc:'2.0',id:1,method:'initialize',params:{
    protocolVersion:1, capabilities:{},
    clientInfo:{name:'kiro-acp-ask',version:'0.1.0'}
  }});
  process.stderr.write('[INIT] OK\n');

  const sessionResp = await send({jsonrpc:'2.0',id:2,method:'session/new',params:{
    cwd:'/home/chuany', mcpServers:[]
  }});
  const sessionId = sessionResp.result?.sessionId;
  process.stderr.write('[SESSION] ' + sessionId + '\n');

  process.stderr.write('[SENDING PROMPT]\n');
  const promptResp = await Promise.race([
    send({jsonrpc:'2.0',id:3,method:'session/prompt',params:{
      sessionId: sessionId,
      prompt: [{type:'text', text:'say hi'}]
    }}),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout 60s')), 60000))
  ]);

  process.stderr.write('\n[DONE] stopReason=' + (promptResp.result?.stopReason || 'none') + '\n');
  process.stderr.write('[FULL RESPONSE] ' + JSON.stringify(promptResp).slice(0, 2000) + '\n');
  process.stderr.write('[UPDATES] ' + updates.length + '\n');
  for (const u of updates) {
    process.stderr.write('  [' + u.kind + '] ' + JSON.stringify(u.data).slice(0, 500) + '\n');
  }
  
  // Output collected text
  if (fullText) {
    process.stdout.write(fullText);
  } else if (promptResp.result?.content) {
    for (const block of promptResp.result.content) {
      if (block.type === 'text') process.stdout.write(block.text);
    }
  }

  child.stdin.end();
  child.kill();
  process.exit(0);
}

main().catch(e => {
  process.stderr.write('\n[ERROR] ' + e.message + '\n');
  process.stderr.write('[UPDATES] ' + updates.length + '\n');
  if (fullText) process.stderr.write('[TEXT SO FAR] ' + fullText + '\n');
  for (const u of updates.slice(-5)) {
    process.stderr.write('  ' + u.kind + '\n');
  }
  child.kill();
  process.exit(1);
});
