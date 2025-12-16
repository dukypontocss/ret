const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Configuração do Banco de Dados SQLite (Arquivo local)
const db = new sqlite3.Database('./rpg.db');

// Inicialização das Tabelas
db.serialize(() => {
    // Tabela de Mesas
    db.run(`CREATE TABLE IF NOT EXISTS tables (
        id TEXT PRIMARY KEY,
        gm_code TEXT, -- Senha do mestre
        schema TEXT DEFAULT '[]' -- Estrutura da ficha em JSON
    )`);
    // Garantir coluna 'name' para compatibilidade com versões anteriores
    db.all("PRAGMA table_info(tables)", (err, cols) => {
        if (!err && Array.isArray(cols)) {
            const hasName = cols.some(c => c && c.name === 'name');
            if (!hasName) {
                db.run("ALTER TABLE tables ADD COLUMN name TEXT", (alterErr) => {
                    if (alterErr) console.warn('Não foi possível adicionar coluna name:', alterErr.message);
                });
            }
        }
    });
    
    // Tabela de Jogadores/Fichas
    db.run(`CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        table_id TEXT,
        name TEXT,
        data TEXT DEFAULT '{}' -- Dados preenchidos da ficha
    )`);

    // Tabela de Inventários dos Jogadores
    db.run(`CREATE TABLE IF NOT EXISTS inventories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT,
        table_id TEXT,
        items TEXT DEFAULT '[]' -- Array de itens em JSON
    )`);
    // Remove possíveis duplicatas antigas mantendo apenas a entrada mais recente por player_id,
    // então cria um índice único em player_id para evitar duplicações futuras.
    db.run("DELETE FROM inventories WHERE id NOT IN (SELECT MAX(id) FROM inventories GROUP BY player_id)", (delErr) => {
        if (delErr) console.warn('Erro ao limpar inventários duplicados:', delErr.message);
        db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventories_player ON inventories(player_id)", (idxErr) => {
            if (idxErr) console.warn('Não foi possível criar índice único em inventories.player_id:', idxErr.message);
        });
    });

    // Tabela de Histórico (Feed)
    db.run(`CREATE TABLE IF NOT EXISTS feed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id TEXT,
        type TEXT, -- 'chat', 'image', 'monster', 'item', 'condition', 'scenario'
        sender TEXT, -- Nome do remetente
        is_gm INTEGER, -- 0 ou 1
        content TEXT, -- JSON ou Texto
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.use(express.static(path.join(__dirname, 'public')));
// Allow larger JSON payloads (base64 images sent in sheet data)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- API ---

// Criar Mesa
app.post('/api/create-table', (req, res) => {
    const tableId = Math.random().toString(36).substr(2, 6).toUpperCase();
    const gmCode = Math.random().toString(36).substr(2, 8);
    const name = (req.body && req.body.name) ? req.body.name : `Mesa ${tableId}`;
    
    db.run('INSERT INTO tables (id, name, gm_code) VALUES (?, ?, ?)', [tableId, name, gmCode], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ tableId, gmCode, name });
    });
});

// Entrar na Mesa (Login)
app.post('/api/join', (req, res) => {
    const { tableId, name, gmCode } = req.body;
    
    db.get('SELECT * FROM tables WHERE id = ?', [tableId], (err, row) => {
        if (!row) return res.status(404).json({ error: 'Mesa não encontrada' });
        
        const isGm = gmCode === row.gm_code;
        const playerId = isGm ? 'GM-' + tableId : name + '-' + tableId;

        // Se for jogador, garante que existe registro
        if (!isGm) {
            db.run('INSERT OR IGNORE INTO players (id, table_id, name) VALUES (?, ?, ?)', [playerId, tableId, name]);
        }

        res.json({ 
            tableId, 
            isGm, 
            playerId, 
            schema: JSON.parse(row.schema),
            tableName: row.name || null
        });
    });
});

// Carregar Dados Iniciais
app.get('/api/table/:id/data', (req, res) => {
    const tableId = req.params.id;
    const playerId = req.query.playerId;

    db.serialize(() => {
        const result = {};
        
        // Carrega Schema
        db.get('SELECT schema, name FROM tables WHERE id = ?', [tableId], (err, row) => {
            if (row) {
                result.schema = JSON.parse(row.schema);
                result.tableName = row.name || null;
            }
            
            // Carrega Ficha do Jogador
            db.get('SELECT data FROM players WHERE id = ?', [playerId], (err, pRow) => {
                if (pRow) result.sheetData = JSON.parse(pRow.data);
                
                // Carrega Histórico do Feed
                db.all('SELECT * FROM feed WHERE table_id = ? ORDER BY id ASC', [tableId], (err, rows) => {
                    result.feed = (rows && Array.isArray(rows)) ? rows.map(r => ({...r, content: JSON.parse(r.content)})) : [];
                    res.json(result);
                });
            });
        });
    });
});

// Salvar Schema (Mestre)
app.post('/api/save-schema', (req, res) => {
    const { tableId, schema } = req.body;
    db.run('UPDATE tables SET schema = ? WHERE id = ?', [JSON.stringify(schema), tableId], () => {
        io.to(tableId).emit('schema_updated', schema);
        res.json({ success: true });
    });
});

// Salvar Ficha (Jogador)
app.post('/api/save-sheet', (req, res) => {
    const { playerId, data } = req.body;
    db.run('UPDATE players SET data = ? WHERE id = ?', [JSON.stringify(data), playerId], function(err) {
        if (err) return res.status(500).json({ error: err.message });

        // After saving, emit updated players list to the table so the GM sees changes
        db.get('SELECT table_id FROM players WHERE id = ?', [playerId], (err2, row) => {
            if (row) {
                const tableId = row.table_id;
                db.all('SELECT id, name, data, table_id FROM players WHERE table_id = ?', [tableId], (err3, rows) => {
                    if (!err3 && rows && Array.isArray(rows)) {
                        const players = rows.map(r => ({ id: r.id, name: r.name, data: r.data ? JSON.parse(r.data) : {}, tableId: r.table_id }));
                        io.to(tableId).emit('players_updated', players);
                    }
                });
            }
        });

        res.json({ success: true });
    });
});

// Carregar Inventário do Jogador
app.get('/api/inventory/:playerId', (req, res) => {
    const playerId = req.params.playerId;
    // Select the latest inventory row for this player (in case of historical duplicates)
    db.get('SELECT items FROM inventories WHERE player_id = ? ORDER BY id DESC LIMIT 1', [playerId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            try {
                return res.json({ items: JSON.parse(row.items) });
            } catch (e) {
                return res.status(500).json({ error: 'Invalid inventory data' });
            }
        }
        // Criar inventário vazio se não existir
        db.get('SELECT table_id FROM players WHERE id = ?', [playerId], (err2, pRow) => {
            if (pRow) {
                db.run('INSERT INTO inventories (player_id, table_id, items) VALUES (?, ?, ?)',
                    [playerId, pRow.table_id, '[]'],
                    () => res.json({ items: [] })
                );
            } else {
                res.json({ items: [] });
            }
        });
    });
});

// Salvar Inventário do Jogador
app.post('/api/inventory/:playerId', (req, res) => {
    const playerId = req.params.playerId;
    const { items } = req.body;
    
    db.get('SELECT table_id FROM players WHERE id = ?', [playerId], (err, pRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!pRow) return res.status(404).json({ error: 'Jogador não encontrado' });
        
        // Try to update existing inventory first
        db.run('UPDATE inventories SET items = ? WHERE player_id = ?', [JSON.stringify(items), playerId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes && this.changes > 0) {
                return res.json({ success: true });
            }
            // No existing row updated -> insert a new one
            db.run('INSERT INTO inventories (player_id, table_id, items) VALUES (?, ?, ?)',
                [playerId, pRow.table_id, JSON.stringify(items)],
                (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ success: true });
                }
            );
        });
    });
});

// Obter dados completos do jogador (para visualização do mestre)
app.get('/api/player/:playerId/view', (req, res) => {
    const playerId = req.params.playerId;
    
    db.serialize(() => {
        db.get('SELECT id, name, data, table_id FROM players WHERE id = ?', [playerId], (err, player) => {
            if (err || !player) return res.status(404).json({ error: 'Jogador não encontrado' });
            
            db.get('SELECT items FROM inventories WHERE player_id = ?', [playerId], (err2, inv) => {
                res.json({
                    player: {
                        id: player.id,
                        name: player.name,
                        data: JSON.parse(player.data || '{}')
                    },
                    inventory: inv ? JSON.parse(inv.items) : []
                });
            });
        });
    });
});

// --- SOCKET.IO (Tempo Real) ---

io.on('connection', (socket) => {
    socket.on('join_table', (payload) => {
        // payload can be either a string (old clients) or an object { tableId, playerId, name }
        const tableId = typeof payload === 'string' ? payload : payload.tableId;
        socket.join(tableId);

        // Emit current players list for this table
        db.all('SELECT id, name, data, table_id FROM players WHERE table_id = ?', [tableId], (err, rows) => {
            if (!err && rows && Array.isArray(rows)) {
                const players = rows.map(r => ({ id: r.id, name: r.name, data: r.data ? JSON.parse(r.data) : {}, tableId: r.table_id }));
                io.to(tableId).emit('players_updated', players);
            }
        });
    });

    socket.on('send_message', (data) => {
        const { tableId, type, sender, isGm, content } = data;
        const contentStr = JSON.stringify(content);
        
        db.run('INSERT INTO feed (table_id, type, sender, is_gm, content) VALUES (?, ?, ?, ?, ?)', 
            [tableId, type, sender, isGm, contentStr], 
            function(err) {
                if (!err) {
                    const newItem = { id: this.lastID, tableId, type, sender, isGm, content, timestamp: new Date() };
                    io.to(tableId).emit('new_feed_item', newItem);
                }
            }
        );
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});