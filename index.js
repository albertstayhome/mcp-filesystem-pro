#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

// Ensure all console.log output goes to stderr so it doesn't corrupt stdout JSON-RPC
const log = (...args) => console.error(...args);

log('Starting Zero-Dependency MCP Filesystem Server...');

const initialTargetDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
let realTargetDir = initialTargetDir;

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

// Robust path traversal and symlink escape prevention
async function getSafePath(targetPath) {
    const resolvedPath = path.resolve(realTargetDir, targetPath);
    let pathToCheck = resolvedPath;
    try {
        pathToCheck = await fs.realpath(resolvedPath);
    } catch (err) {
        if (err.code === 'ENOENT') {
            const parent = path.dirname(resolvedPath);
            try {
                const realParent = await fs.realpath(parent);
                pathToCheck = path.join(realParent, path.basename(resolvedPath));
            } catch (parentErr) {
                throw new Error('Access denied: Invalid directory structure.');
            }
        } else {
            throw new Error(`Filesystem error: ${err.message}`);
        }
    }
    
    const rel = path.relative(realTargetDir, pathToCheck);
    const isSafe = !rel.startsWith('..') && !path.isAbsolute(rel);
    if (!isSafe) {
        throw new Error('Access denied: Path outside restricted workspace.');
    }
    return pathToCheck;
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
                    const safePath = await getSafePath(p);
                    const items = await fs.readdir(safePath, { withFileTypes: true });
                    const formatted = items.map(i => `${i.isDirectory() ? '[DIR] ' : '[FILE]'} ${i.name}`).join('\n');
                    sendResponse(msg.id, { content: [{ type: 'text', text: formatted || '(empty directory)' }] });
                }
                else if (name === 'read_file') {
                    if (!args.filePath) throw new Error('Missing filePath parameter');
                    const safePath = await getSafePath(args.filePath);
                    const content = await fs.readFile(safePath, 'utf8');
                    sendResponse(msg.id, { content: [{ type: 'text', text: content }] });
                }
                else if (name === 'write_file') {
                    if (!args.filePath || !args.content) throw new Error('Missing filePath or content parameter');
                    const safePath = await getSafePath(args.filePath);
                    await fs.writeFile(safePath, args.content, 'utf8');
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

async function boot() {
    try {
        realTargetDir = await fs.realpath(initialTargetDir);
        log(`Restricting access to resolved workspace directory: ${realTargetDir}`);
    } catch (e) {
        log(`Fatal: Could not resolve target directory ${initialTargetDir}`);
        process.exit(1);
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
}

boot();
