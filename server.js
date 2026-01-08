const express = require('express');
const path = require('path');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();

app.use(express.static(path.join(__dirname, '/')));

// CONFIGURACIÓN PARA RAILWAY: Puerto dinámico
const PORT = process.env.PORT || 3001;

const JWT_SECRET = process.env.JWT_SECRET || 'TuClaveSecretaMuySeguraYSuperLarga_12345';

// CONFIGURACIÓN PARA RAILWAY: Conexión mediante variables de entorno
const db = mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || 'admin',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'inventario_uniformes',
    port: process.env.DB_PORT || process.env.MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

app.use(express.json());
app.use(cors());

// Verificación de conexión
db.promise().query('SELECT 1')
    .then(() => {
        console.log('Conexión exitosa a MySQL en Railway');
    })
    .catch(err => {
        console.error('Error al conectar a la Base de Datos:', err.message);
    });

const router = express.Router();

router.get('/', (req, res) => {
    res.send('Servidor de Inventario de Uniformes activo en Railway');
});

// --- LOGIN ---
router.post('/login', (req, res) => {
    const { Usuario, Contrasena } = req.body;
    if (!Usuario || !Contrasena) return res.status(400).json({ error: 'Faltan usuario o contrasena.' });

    const sql = 'SELECT ID_Usuario, Contrasena, Rol FROM usuarios WHERE Usuario = ?';
    db.query(sql, [Usuario], async (error, results) => {
        if (error) return res.status(500).json({ error: 'Error del servidor.' });
        if (results.length === 0) return res.status(401).json({ error: 'Usuario o contrasena incorrectos.' });

        const user = results[0];
        try {
            const match = await bcrypt.compare(Contrasena, user.Contrasena);
            if (match) {
                const token = jwt.sign({ id: user.ID_Usuario, user: Usuario, rol: user.Rol }, JWT_SECRET, { expiresIn: '1h' });
                res.status(200).json({ mensaje: 'Inicio de sesion exitoso!', usuario: Usuario, rol: user.Rol, token: token });
            } else {
                res.status(401).json({ error: 'Usuario o contrasena incorrectos.' });
            }
        } catch (e) { res.status(500).json({ error: 'Error interno.' }); }
    });
});

// --- UNIFORMES ---
router.get('/uniformes', (req, res) => {
    const sql = 'SELECT ID_Uniforme, Prenda, Talla, Cantidad, Precio FROM uniformes ORDER BY ID_Uniforme DESC';
    db.query(sql, (error, results) => {
        if (error) return res.status(500).json({ error: 'Error al obtener uniformes.' });
        res.status(200).json(results);
    });
});

router.post('/uniformes', (req, res) => {
    const { prenda, talla, cantidad, precio } = req.body;
    if (!prenda || !talla || !cantidad || !precio) return res.status(400).json({ error: 'Faltan campos.' });

    const sql = 'INSERT INTO uniformes (Prenda, Talla, Cantidad, Precio) VALUES (?, ?, ?, ?)';
    db.query(sql, [prenda, talla, cantidad, precio], (error, results) => {
        if (error) return res.status(500).json({ error: 'Error al crear.' });
        res.status(201).json({ mensaje: 'Agregado.', id: results.insertId });
    });
});

// --- VENTAS (REGISTRO) ---
router.post('/ventas', async (req, res) => {
    const { cliente_nombre, id_usuario_gestor, total, detalles } = req.body;
    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        for (const item of detalles) {
            await connection.query('UPDATE uniformes SET Cantidad = Cantidad - ? WHERE ID_Uniforme = ?', [item.cantidad_vendida, item.id_uniforme]);
        }
        
        const [ventaResult] = await connection.query('INSERT INTO ventas (Cliente_Nombre, Total, ID_Usuario_Gestor) VALUES (?, ?, ?)', [cliente_nombre, total, id_usuario_gestor]);
        
        for (const item of detalles) {
            await connection.query('INSERT INTO detalle_venta (ID_Venta, ID_Uniforme, Cantidad_Vendida, Precio_Unitario) VALUES (?, ?, ?, ?)', [ventaResult.insertId, item.id_uniforme, item.cantidad_vendida, item.precio_unitario]);
        }

        await connection.commit();
        res.status(201).json({ mensaje: 'Venta registrada.', id_venta: ventaResult.insertId });
    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({ error: 'Error en venta.' });
    } finally {
        if (connection) connection.release();
    }
});

// --- NUEVO: RUTA PARA OBTENER HISTORIAL DE VENTAS ---
router.get('/ventas', async (req, res) => {
    const sql = `
        SELECT v.ID_Venta, v.Fecha_Venta, v.Cliente_Nombre, v.Total, u.Usuario as Gestor_Usuario,
        GROUP_CONCAT(CONCAT(un.Prenda, ' (', un.Talla, ')') SEPARATOR ', ') as Detalle_Productos
        FROM ventas v
        JOIN usuarios u ON v.ID_Usuario_Gestor = u.ID_Usuario
        JOIN detalle_venta dv ON v.ID_Venta = dv.ID_Venta
        JOIN uniformes un ON dv.ID_Uniforme = un.ID_Uniforme
        GROUP BY v.ID_Venta
        ORDER BY v.Fecha_Venta DESC`;
    try {
        const [results] = await db.promise().query(sql);
        res.status(200).json(results);
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: 'Error al obtener historial de ventas.' }); 
    }
});

// --- MOVIMIENTOS: ENTRADA ---
router.post('/movimientos/entrada', async (req, res) => {
    const { id_uniforme, cantidad_entrada, id_usuario } = req.body;
    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();
        const [u] = await connection.query('SELECT Prenda, Talla FROM uniformes WHERE ID_Uniforme = ?', [id_uniforme]);
        await connection.query('UPDATE uniformes SET Cantidad = Cantidad + ? WHERE ID_Uniforme = ?', [cantidad_entrada, id_uniforme]);
        const [ns] = await connection.query('SELECT Cantidad FROM uniformes WHERE ID_Uniforme = ?', [id_uniforme]);
        
        await connection.query('INSERT INTO movimientos (ID_Usuario, Tipo, Prenda, Talla, Cantidad, Stock_Resultante) VALUES (?, "ENTRADA", ?, ?, ?, ?)', [id_usuario, u[0].Prenda, u[0].Talla, cantidad_entrada, ns[0].Cantidad]);
        
        await connection.commit();
        res.status(201).json({ mensaje: 'Stock actualizado.' });
    } catch (e) { if (connection) await connection.rollback(); res.status(500).json({ error: 'Error en movimiento.' }); }
    finally { if (connection) connection.release(); }
});

// --- NUEVO: MOVIMIENTOS: SALIDA (BOTÓN ROJO) ---
router.post('/movimientos/salida', async (req, res) => {
    const { id_uniforme, cantidad_salida, id_usuario } = req.body;
    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [stockActual] = await connection.query('SELECT Cantidad, Prenda, Talla FROM uniformes WHERE ID_Uniforme = ?', [id_uniforme]);
        
        if (stockActual[0].Cantidad < cantidad_salida) {
            return res.status(400).json({ error: 'Stock insuficiente.' });
        }

        await connection.query('UPDATE uniformes SET Cantidad = Cantidad - ? WHERE ID_Uniforme = ?', [cantidad_salida, id_uniforme]);
        
        await connection.query(
            'INSERT INTO movimientos (ID_Usuario, Tipo, Prenda, Talla, Cantidad, Stock_Resultante) VALUES (?, "SALIDA", ?, ?, ?, ?)', 
            [id_usuario, stockActual[0].Prenda, stockActual[0].Talla, cantidad_salida, stockActual[0].Cantidad - cantidad_salida]
        );
        
        await connection.commit();
        res.status(201).json({ mensaje: 'Retiro registrado.' });
    } catch (e) { if (connection) await connection.rollback(); res.status(500).json({ error: 'Error.' }); }
    finally { if (connection) connection.release(); }
});

// --- REPORTES ---
router.get('/reporte/stock-valor', async (req, res) => {
    const sql = 'SELECT Prenda, Talla, Cantidad, (Cantidad * Precio) as Valor_Total_Stock FROM uniformes';
    try {
        const [results] = await db.promise().query(sql);
        res.status(200).json({ data: results });
    } catch (e) { res.status(500).json({ error: 'Error en reporte.' }); }
});

router.get('/movimientos', async (req, res) => {
    const sql = `SELECT m.*, u.Usuario AS Usuario_Registro 
                 FROM movimientos m 
                 JOIN usuarios u ON m.ID_Usuario = u.ID_Usuario 
                 ORDER BY m.Fecha_Hora DESC`;
    try {
        const [movs] = await db.promise().query(sql);
        res.status(200).json(movs);
    } catch (e) { res.status(500).json({ error: 'Error.' }); }
});

app.use('/api', router);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});
