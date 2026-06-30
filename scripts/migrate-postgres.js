const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

const schemaPath = path.resolve(__dirname, '..', 'database', 'schema.sql');

const TABLES = [
  'companies',
  'departments',
  'users',
  'feedback',
  'login_logs',
  'audit_logs',
  'password_reset_tokens'
];

const ensureFallbackSuperAdmin = async () => {
  const hashedPassword = await bcrypt.hash('Admin@123', 10);
  const { rows } = await db.raw.query(
    `INSERT INTO users (
       employee_id, name, email, password, designation, company_id, department_id, role, status
     )
     VALUES ($1, $2, $3, $4, $5, 1, 1, 'super_admin', 'active')
     ON CONFLICT (email) DO UPDATE
       SET role = 'super_admin',
           status = 'active',
           company_id = 1,
           department_id = 1,
           password = EXCLUDED.password,
           updated_at = NOW()
     RETURNING id`,
    ['SYS001', 'System Administrator', 'admin@company.com', hashedPassword, 'Super Admin']
  );

  await db.raw.query("SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 1), true)");
  return { id: rows[0]?.id };
};

const collectCounts = async () => {
  const counts = {};
  for (const table of TABLES) {
    const { rows } = await db.raw.query(`SELECT COUNT(*)::INTEGER AS count FROM ${table}`);
    counts[table] = rows[0].count;
  }
  return counts;
};

const main = async () => {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await db.raw.query(schemaSql);

  const superAdmin = await ensureFallbackSuperAdmin();
  const counts = await collectCounts();
  const totalRecords = Object.values(counts).reduce((sum, count) => sum + Number(count), 0);

  console.log(JSON.stringify({
    status: 'ok',
    provider: 'postgresql',
    database: process.env.DB_NAME || 'employee_feedback',
    tables: TABLES.length,
    records: totalRecords,
    counts,
    superAdminEnsured: true,
    superAdminEmail: 'admin@company.com',
    superAdminId: superAdmin.id
  }, null, 2));
};

main()
  .catch((error) => {
    const details = {
      message: error.message,
      code: error.code,
      address: error.address,
      port: error.port
    };
    console.error('PostgreSQL migration failed:', JSON.stringify(details));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
