#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

// Ensure all console.log output goes to stderr so it doesn't corrupt stdout JSON-RPC
const log = (...args) => console.error(...args);

log('Starting Zero-Dependency MCP Filesystem Server...');

const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
log(`Restricting access to directory: ${targetDir}`);

function isSafePath(targetPath) {
    const resolved = path.resolve(targetDir, targetPath);
    return resolved.startsWith(targetDir);
}

// JSON-RPC State
let buffer = '';

// Send response to stdout
function sendResponse(id, result, error = null) {
    const response = {
        jsonrpc: '2.0',
        id: id
    };
    if (error) {
        response.error = error;
    } else {
        response.result = result;
    }
    process.stdout.write(JSON.stringify(response) + '\n');
}

// Handle incoming messages
async function handleMessage(message) {
    try {
        const msg = JSON.parse(message);
        
        if (msg.method === 'initialize') {
            sendResponse(msg.id, {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: {}
                },
                serverInfo: {
                    name: 'mcp-filesystem-pro',
                    version: '1.0.0'
                }
            });
        } 
        else if (msg.method === 'notifications/initialized') {
            log('Client initialized.');
        }
        else if (msg.method === 'tools/list') {
            sendResponse(msg.id, {
                tools: [
                    {
                        name: 'list_directory',
                        description: 'List contents of a directory within the restricted workspace.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                dirPath: { type: 'string', description: 'Relative path to directory' }
                            }
                        }
                    },
                    {
                        name: 'read_file',
                        description: 'Read the contents of a file within the restricted workspace.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                filePath: { type: 'string', description: 'Relative path to file' }
                            },
                            required: ['filePath']
                        }
                    },
                    {
                        name: 'write_file',
                        description: 'Write content to a file within the restricted workspace.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                filePath: { type: 'string', description: 'Relative path to file' },
                                content: { type: 'string', description: 'Content to write' }
                            },
                            required: ['filePath', 'content']
                        }
                    }
                ]
            });
        }
        else if (msg.method === 'tools/call') {
            const { name, arguments: args } = msg.params;
            try {
                if (name === 'list_directory') {
                    const p = args.dirPath || '.';
                    if (!isSafePath(p)) throw new Error('Access denied: Path outside restricted workspace.');
                    const items = await fs.readdir(path.resolve(targetDir, p), { withFileTypes: true });
                    const formatted = items.map(i => `${i.isDirectory() ? '[DIR] ' : '[FILE]'} ${i.name}`).join('\n');
                    sendResponse(msg.id, { content: [{ type: 'text', text: formatted || '(empty directory)' }] });
                }
                else if (name === 'read_file') {
                    if (!isSafePath(args.filePath)) throw new Error('Access denied: Path outside restricted workspace.');
                    const content = await fs.readFile(path.resolve(targetDir, args.filePath), 'utf8');
                    sendResponse(msg.id, { content: [{ type: 'text', text: content }] });
                }
                else if (name === 'write_file') {
                    if (!isSafePath(args.filePath)) throw new Error('Access denied: Path outside restricted workspace.');
                    await fs.writeFile(path.resolve(targetDir, args.filePath), args.content, 'utf8');
                    sendResponse(msg.id, { content: [{ type: 'text', text: 'File written successfully.' }] });
                }
                else {
                    sendResponse(msg.id, null, { code: -32601, message: 'Tool not found' });
                }
            } catch (err) {
                sendResponse(msg.id, { content: [{ type: 'text', text: `Error: ${err.message}`, isError: true }] });
            }
        }
    } catch (e) {
        log('Error parsing JSON-RPC message:', e.message);
    }
}

// Read from stdin
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer
    
    for (const line of lines) {
        if (line.trim()) {
            handleMessage(line);
        }
    }
});

process.stdin.on('end', () => {
    log('Client disconnected.');
    process.exit(0);
});

log('MCP Filesystem Server is ready. Listening on stdin for JSON-RPC messages...');
