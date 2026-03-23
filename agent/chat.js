/**
 * Sally v2 — Interactive CLI chat
 * Run: node agent/chat.js
 */
import readline from 'readline';
import { SallyAgent } from './sally-agent.js';

const agent = new SallyAgent();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const ask = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

(async () => {
    console.log('Initializing Sally v2...');
    await agent.initialize();
    console.log('\n💬 Sally v2 — type your question, or "exit" to quit\n');

    while (true) {
        const input = (await ask('You: ')).trim();
        if (!input) continue;
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') break;

        process.stdout.write('\nSally: ');
        try {
            const result = await agent.query(input);
            console.log(result.answer);
            console.log(`\n  [agent: ${result.agent} | tools: ${result.toolsUsed.join(', ') || 'none'}]\n`);
        } catch (err) {
            console.error('Error:', err.message, '\n');
        }
    }

    rl.close();
    process.exit(0);
})();
