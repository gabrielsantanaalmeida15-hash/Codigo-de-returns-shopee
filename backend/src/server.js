import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import { pool } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map(value => value.trim()) || false }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp());
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true }));

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './storage/uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => callback(null, /^(image|video)\//.test(file.mimetype))
});

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const registerSchema = credentialsSchema.extend({ name: z.string().trim().min(2).max(120), role: z.enum(['client', 'agent']).default('client') });
const productSchema = z.object({ name: z.string().trim().min(2).max(180), price: z.coerce.number().nonnegative(), stock: z.coerce.number().int().nonnegative() });
const orderSchema = z.object({ productId: z.string().uuid(), customerId: z.string().uuid() });
const returnSchema = z.object({ orderId: z.string().uuid(), productId: z.string().uuid(), reason: z.string().trim().min(2).max(120), note: z.string().trim().min(2), amount: z.coerce.number().nonnegative() });
const statusSchema = z.object({ status: z.enum(['Pendente', 'Em análise', 'Aprovada', 'Rejeitada']) });

function tokenFor(user) { return jwt.sign({ sub: user.id, role: user.role, name: user.name }, jwtSecret, { expiresIn: '8h' }); }
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Autenticacao obrigatoria' });
  try { req.user = jwt.verify(token, jwtSecret); next(); } catch { return res.status(401).json({ error: 'Token invalido ou expirado' }); }
}
function allow(...roles) { return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Permissao insuficiente' }); }
async function audit(client, actorId, action, entity, entityId, metadata = {}) { await client.query('INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [actorId, action, entity, entityId, metadata]); }
function failValidation(error, res) { return res.status(400).json({ error: 'Dados invalidos', details: error.flatten?.() || error.message }); }

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'ok' }); }
  catch { res.status(503).json({ status: 'error', database: 'unavailable' }); }
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const hash = await bcrypt.hash(data.password, 12);
    const result = await pool.query('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role', [data.name, data.email.toLowerCase(), hash, data.role]);
    const user = result.rows[0];
    res.status(201).json({ user, token: tokenFor(user) });
  } catch (error) { if (error instanceof z.ZodError) return failValidation(error, res); if (error.code === '23505') return res.status(409).json({ error: 'E-mail ja cadastrado' }); next(error); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const data = credentialsSchema.parse(req.body);
    const result = await pool.query('SELECT id,name,email,password_hash,role FROM users WHERE email=$1', [data.email.toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(data.password, user.password_hash))) return res.status(401).json({ error: 'Credenciais invalidas' });
    delete user.password_hash;
    res.json({ user, token: tokenFor(user) });
  } catch (error) { if (error instanceof z.ZodError) return failValidation(error, res); next(error); }
});

app.get('/api/me', auth, async (req, res, next) => { try { const result = await pool.query('SELECT id,name,email,role,created_at FROM users WHERE id=$1', [req.user.sub]); res.json(result.rows[0]); } catch (error) { next(error); } });

app.get('/api/products', auth, async (_req, res, next) => { try { const result = await pool.query('SELECT id,name,price,stock,created_at FROM products ORDER BY created_at DESC'); res.json(result.rows); } catch (error) { next(error); } });
app.post('/api/products', auth, allow('agent'), async (req, res, next) => {
  try { const data = productSchema.parse(req.body); const result = await pool.query('INSERT INTO products (name,price,stock) VALUES ($1,$2,$3) RETURNING *', [data.name, data.price, data.stock]); await audit(pool, req.user.sub, 'create', 'product', result.rows[0].id, data); res.status(201).json(result.rows[0]); }
  catch (error) { if (error instanceof z.ZodError) return failValidation(error, res); next(error); }
});

app.get('/api/orders', auth, async (req, res, next) => { try { const result = await pool.query('SELECT o.id,o.code,o.product_id,o.customer_id,p.name AS product,p.price,u.name AS customer FROM orders o JOIN products p ON p.id=o.product_id JOIN users u ON u.id=o.customer_id WHERE $1 OR o.customer_id=$2 ORDER BY o.created_at DESC', [req.user.role === 'agent', req.user.sub]); res.json(result.rows); } catch (error) { next(error); } });
app.post('/api/orders', auth, allow('agent'), async (req, res, next) => {
  try { const data = orderSchema.parse(req.body); const client = await pool.connect(); try { await client.query('BEGIN'); const code = `#PED-${Date.now()}`; const result = await client.query('INSERT INTO orders (code,product_id,customer_id) VALUES ($1,$2,$3) RETURNING *', [code, data.productId, data.customerId]); await audit(client, req.user.sub, 'create', 'order', result.rows[0].id, data); await client.query('COMMIT'); res.status(201).json(result.rows[0]); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }
  catch (error) { if (error instanceof z.ZodError) return failValidation(error, res); next(error); }
});

app.get('/api/returns', auth, async (req, res, next) => { try { const result = await pool.query('SELECT r.*,o.code AS order_code,p.name AS product,u.name AS customer FROM returns r JOIN orders o ON o.id=r.order_id JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.customer_id WHERE $1 OR r.customer_id=$2 ORDER BY r.created_at DESC', [req.user.role === 'agent', req.user.sub]); res.json(result.rows); } catch (error) { next(error); } });
app.post('/api/returns', auth, allow('client'), async (req, res, next) => {
  try { const data = returnSchema.parse(req.body); const result = await pool.query('INSERT INTO returns (code,order_id,product_id,customer_id,reason,note,amount) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [`RET-${Date.now()}`, data.orderId, data.productId, req.user.sub, data.reason, data.note, data.amount]); await audit(pool, req.user.sub, 'create', 'return', result.rows[0].id, data); res.status(201).json(result.rows[0]); }
  catch (error) { if (error instanceof z.ZodError) return failValidation(error, res); next(error); }
});
app.patch('/api/returns/:id/status', auth, allow('agent'), async (req, res, next) => {
  try { const data = statusSchema.parse(req.body); const result = await pool.query('UPDATE returns SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [data.status, req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Devolucao nao encontrada' }); await audit(pool, req.user.sub, 'update_status', 'return', req.params.id, data); await pool.query('INSERT INTO notifications (user_id,title,message) SELECT customer_id,$1,$2 FROM returns WHERE id=$3', ['Atualizacao da devolucao', `Sua devolucao agora esta: ${data.status}`, req.params.id]); res.json(result.rows[0]); }
  catch (error) { if (error instanceof z.ZodError) return failValidation(error, res); next(error); }
});

app.post('/api/returns/:id/attachments', auth, upload.array('files', 5), async (req, res, next) => {
  try { if (!req.files?.length) return res.status(400).json({ error: 'Envie ao menos um arquivo de imagem ou video' }); const owner = await pool.query('SELECT customer_id FROM returns WHERE id=$1', [req.params.id]); if (!owner.rowCount || (req.user.role !== 'agent' && owner.rows[0].customer_id !== req.user.sub)) return res.status(404).json({ error: 'Devolucao nao encontrada' }); const values=[]; for (const file of req.files) { const result=await pool.query('INSERT INTO return_attachments (return_id,storage_key,original_name,mime_type,size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id,original_name,mime_type,size_bytes', [req.params.id,file.filename,file.originalname,file.mimetype,file.size]); values.push(result.rows[0]); } await audit(pool, req.user.sub, 'upload', 'return_attachment', req.params.id, { count: values.length }); res.status(201).json(values); }
  catch (error) { for (const file of req.files || []) fs.rmSync(file.path, { force: true }); next(error); }
});

app.get('/api/notifications', auth, async (req, res, next) => { try { const result=await pool.query('SELECT id,title,message,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[req.user.sub]); res.json(result.rows); } catch(error) { next(error); } });
app.get('/api/audit-logs', auth, allow('agent'), async (_req, res, next) => { try { const result=await pool.query('SELECT l.*,u.name AS actor FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.created_at DESC LIMIT 200'); res.json(result.rows); } catch(error) { next(error); } });

app.use((error, req, res, _next) => { req.log?.error(error); res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Arquivo excede 10MB' : 'Erro interno do servidor' }); });

if (process.env.NODE_ENV !== 'test') app.listen(port, () => console.log(`Fluxo API listening on :${port}`));
export { app };
