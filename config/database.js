const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_CONNECTION_STRING;
const disableDatabaseUrl = process.env.DB_DISABLE_DATABASE_URL === 'true';
const effectiveConnectionString = disableDatabaseUrl ? undefined : connectionString;


let usingMemoryFallback = false;
let fallbackInitPromise = null;

const shouldUseSsl = () => {
  if (process.env.DB_SSL === 'false') return false;
  if (process.env.DB_SSL === 'true') return { rejectUnauthorized: false };
  return process.env.NODE_ENV === 'production' || /render\.com|sslmode=require/i.test(effectiveConnectionString || '')
    ? { rejectUnauthorized: false }
    : false;
};

const basePoolOptions = () => ({
  max: Number(process.env.DB_POOL_MAX || (process.env.VERCEL ? 5 : 10)),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  allowExitOnIdle: true,
  ssl: shouldUseSsl()
});

const createPostgresPool = () => {
  const postgresPool = new Pool(effectiveConnectionString ? {
    connectionString: effectiveConnectionString,
    ...basePoolOptions()
  } : {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'employee_feedback',
    port: Number(process.env.DB_PORT || 5432),
    ...basePoolOptions()
  });

  postgresPool.on('error', (error) => {
    console.error('Unexpected PostgreSQL idle client error:', error.message);
  });

  return postgresPool;
};

let pool = createPostgresPool();

const shouldUseMemoryFallback = (error) => (
  process.env.NODE_ENV !== 'production' &&
  process.env.DB_DISABLE_MEMORY_FALLBACK !== 'true' &&
  ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(error?.code)
);

const toPostgresSql = (sql) => {
  let index = 0;
  return sql
    .replace(/\?/g, () => `$${++index}`)
    .replace(/status = "active"/g, "status = 'active'")
    .replace(/status = "inactive"/g, "status = 'inactive'")
    .replace(/\bFALSE\b/g, 'false')
    .replace(/\bTRUE\b/g, 'true')
    .replace(/\bDATE\(([^)]+)\)/gi, 'DATE_TRUNC(\'day\', $1)');
};

const appendReturningId = (sql) => {
  const trimmed = sql.trim();
  if (!/^insert\s+into/i.test(trimmed) || /\breturning\b/i.test(trimmed)) {
    return sql;
  }
  return `${sql} RETURNING id`;
};

const isTransientDatabaseError = (error) => (
  ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03', '53300', '08006'].includes(error?.code)
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetries = async (operation) => {
  const attempts = Number(process.env.DB_RETRY_ATTEMPTS || 2);
  let lastError;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientDatabaseError(error)) break;
      await delay(Number(process.env.DB_RETRY_DELAY_MS || 250) * (attempt + 1));
    }
  }

  throw lastError;
};

const normalizeResult = (result, sql) => {
  if (/^insert\s+into/i.test(sql.trim())) {
    return [{ insertId: result.rows[0]?.id, rowCount: result.rowCount }, result.fields];
  }
  return [result.rows, result.fields];
};

const createMemoryFallbackPool = async () => {
  const { newDb } = require('pg-mem');
  const memoryDb = newDb({ autoCreateForeignKeyIndices: true });

  memoryDb.public.registerFunction({
    name: 'date_trunc',
    args: ['text', 'timestamp'],
    returns: 'timestamp',
    implementation: (part, value) => {
      const date = new Date(value);
      if (String(part).toLowerCase() === 'month') {
        return new Date(date.getFullYear(), date.getMonth(), 1);
      }
      if (String(part).toLowerCase() === 'day') {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
      }
      return date;
    }
  });

  memoryDb.public.registerFunction({
    name: 'to_char',
    args: ['timestamp', 'text'],
    returns: 'text',
    implementation: (value, format) => {
      const date = new Date(value);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      if (format === 'YYYY-MM') return `${year}-${month}`;
      return date.toISOString();
    }
  });

  ['float', 'integer', 'bigint', 'numeric'].forEach((type) => {
    memoryDb.public.registerFunction({
      name: 'round',
      args: [type, 'integer'],
      returns: 'float',
      implementation: (value, precision) => {
        if (value === null || value === undefined) return null;
        const factor = 10 ** Number(precision || 0);
        return Math.round(Number(value) * factor) / factor;
      }
    });
  });

  const pg = memoryDb.adapters.createPg();
  const memoryPool = new pg.Pool();

  await memoryPool.query(`
    CREATE TABLE companies (
      id SERIAL PRIMARY KEY,
      company_name VARCHAR(255) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE departments (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      department_name VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, department_name)
    );

    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      employee_id VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      mobile VARCHAR(20),
      designation VARCHAR(100),
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      role VARCHAR(30) NOT NULL DEFAULT 'employee',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      last_login TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE feedback (
      id SERIAL PRIMARY KEY,
      given_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      given_to INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      communication INTEGER NOT NULL,
      teamwork INTEGER NOT NULL,
      respect INTEGER NOT NULL,
      responsibility INTEGER NOT NULL,
      leadership INTEGER NOT NULL,
      overall_rating NUMERIC(3,2),
      comment TEXT,
      is_anonymous BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE login_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ip_address VARCHAR(45),
      browser VARCHAR(255),
      operating_system VARCHAR(255),
      login_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      logout_time TIMESTAMP
    );

    CREATE TABLE audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(100),
      module VARCHAR(100),
      record_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      ip_address VARCHAR(45),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(255) NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const hash = bcrypt.hashSync('Admin@123', 10);
  await memoryPool.query(`
    INSERT INTO companies (company_name, status) VALUES
      ('System', 'active'),
      ('Acme Feedback Ratings', 'active');

    INSERT INTO departments (company_id, department_name, status) VALUES
      (1, 'Administration', 'active'),
      (2, 'People Operations', 'active'),
      (2, 'Engineering', 'active');
  `);

  await memoryPool.query(
    `INSERT INTO users (employee_id, name, email, password, mobile, designation, company_id, department_id, role, status)
     VALUES
      ('SYS001', 'System Administrator', 'admin@company.com', $1, '9000000001', 'Super Admin', 1, 1, 'super_admin', 'active'),
      ('ADM001', 'Company Administrator', 'company.admin@company.com', $1, '9000000002', 'Company Admin', 2, 2, 'company_admin', 'active'),
      ('EMP001', 'Demo Employee', 'employee@company.com', $1, '9000000003', 'Analyst', 2, 3, 'employee', 'active'),
      ('EMP002', 'Peer Employee', 'peer@company.com', $1, '9000000004', 'Engineer', 2, 3, 'employee', 'active')`,
    [hash]
  );

  await memoryPool.query(`
    INSERT INTO feedback (given_by, given_to, company_id, department_id, communication, teamwork, respect, responsibility, leadership, overall_rating, comment, is_anonymous)
    VALUES
      (4, 3, 2, 3, 5, 4, 5, 4, 4, 4.40, 'Strong collaboration and ownership.', false),
      (3, 4, 2, 3, 4, 5, 4, 5, 4, 4.40, 'Reliable teammate with clear communication.', true);
  `);

  return memoryPool;
};

const activateMemoryFallback = async (error) => {
  if (!shouldUseMemoryFallback(error)) {
    throw error;
  }

  if (!fallbackInitPromise) {
    fallbackInitPromise = createMemoryFallbackPool().then((memoryPool) => {
      usingMemoryFallback = true;
      pool = memoryPool;
      console.warn('PostgreSQL is unreachable; using seeded in-memory PostgreSQL-compatible development database.');
      return memoryPool;
    });
  }

  return fallbackInitPromise;
};

const wrapClient = (client) => {
  let released = false;
  const execute = async (sql, params = []) => {
    const convertedSql = appendReturningId(toPostgresSql(sql));
    const result = await withRetries(() => client.query(convertedSql, params));
    return normalizeResult(result, convertedSql);
  };

  return {
    execute,
    query: execute,
    release: () => {
      if (!released) {
        released = true;
        client.release();
      }
    }
  };
};

module.exports = {
  get pool() {
    return pool;
  },
  get usingMemoryFallback() {
    return usingMemoryFallback;
  },
  getConnection: async () => {
    try {
      return wrapClient(await withRetries(() => pool.connect()));
    } catch (error) {
      const fallbackPool = await activateMemoryFallback(error);
      return wrapClient(await fallbackPool.connect());
    }
  },
  execute: async (sql, params = []) => {
    const convertedSql = appendReturningId(toPostgresSql(sql));
    try {
      const result = await withRetries(() => pool.query(convertedSql, params));
      return normalizeResult(result, convertedSql);
    } catch (error) {
      const fallbackPool = await activateMemoryFallback(error);
      const result = await fallbackPool.query(convertedSql, params);
      return normalizeResult(result, convertedSql);
    }
  },
  query: async (sql, params = []) => {
    const convertedSql = appendReturningId(toPostgresSql(sql));
    try {
      const result = await withRetries(() => pool.query(convertedSql, params));
      return normalizeResult(result, convertedSql);
    } catch (error) {
      const fallbackPool = await activateMemoryFallback(error);
      const result = await fallbackPool.query(convertedSql, params);
      return normalizeResult(result, convertedSql);
    }
  },
  end: async () => {
    if (pool) {
      await pool.end();
    }
  },
  get raw() {
    return pool;
  }
};
