const bcrypt = require('bcryptjs');

// Contraseñas de Maria y Liz en texto plano
const mariaPassword = 'mistalentos2026';
const lizPassword = 'mistalentos21años';

const saltRounds = 10; // Nivel de seguridad para la encriptación

async function hashPasswords() {
    console.log("--- GENERANDO HASHES DE AUTENTICACIÓN ---");

    // Generar el hash de Maria
    const mariaHash = await bcrypt.hash(mariaPassword, saltRounds);
    console.log(`\nContraseña Original de Maria: ${mariaPassword}`);
    console.log(`Hash Encriptado de Maria: ${mariaHash}`);

    // Generar el hash de Liz
    const lizHash = await bcrypt.hash(lizPassword, saltRounds);
    console.log(`\nContraseña Original de Liz: ${lizPassword}`);
    console.log(`Hash Encriptado de Liz: ${lizHash}`);
    console.log("-----------------------------------------");
}

hashPasswords();