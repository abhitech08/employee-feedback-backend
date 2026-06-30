const pool = require('../config/database');
const { validateCompany } = require('../validators/company');

const getRequestIp = (req) => req.ip || req.connection.remoteAddress;

// Get all companies (Super Admin)
const getAllCompanies = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [companies] = await connection.execute('SELECT * FROM companies ORDER BY created_at DESC');

    res.status(200).json({
      message: 'Companies retrieved successfully',
      data: companies
    });
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Get single company
const getCompanyById = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [companies] = await connection.execute('SELECT * FROM companies WHERE id = ?', [req.params.id]);

    if (companies.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.status(200).json({
      message: 'Company retrieved successfully',
      data: companies[0]
    });
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Create company (Super Admin only)
const createCompany = async (req, res) => {
  let connection;
  try {
    const { company_name } = req.body;
    const { error } = validateCompany({ company_name });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    connection = await pool.getConnection();
    const [existing] = await connection.execute('SELECT id FROM companies WHERE company_name = ?', [company_name]);

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Company already exists' });
    }

    const [result] = await connection.execute('INSERT INTO companies (company_name) VALUES (?)', [company_name]);

    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, new_value, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        'CREATE',
        'companies',
        result.insertId,
        JSON.stringify({ company_name }),
        getRequestIp(req)
      ]
    );

    res.status(201).json({
      message: 'Company created successfully',
      data: { id: result.insertId, company_name, status: 'active' }
    });
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Update company (Super Admin only)
const updateCompany = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { company_name, status } = req.body;

    connection = await pool.getConnection();
    const [existing] = await connection.execute('SELECT * FROM companies WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const oldValue = existing[0];
    const nextValue = {
      company_name: company_name || oldValue.company_name,
      status: status || oldValue.status
    };

    await connection.execute(
      'UPDATE companies SET company_name = ?, status = ? WHERE id = ?',
      [nextValue.company_name, nextValue.status, id]
    );

    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, old_value, new_value, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        'UPDATE',
        'companies',
        id,
        JSON.stringify(oldValue),
        JSON.stringify(nextValue),
        getRequestIp(req)
      ]
    );

    res.status(200).json({ message: 'Company updated successfully' });
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Delete company (Super Admin only)
const deleteCompany = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;

    connection = await pool.getConnection();
    const [companies] = await connection.execute('SELECT * FROM companies WHERE id = ?', [id]);

    if (companies.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    if (companies[0].company_name === 'System') {
      return res.status(403).json({ error: 'Cannot delete system company' });
    }

    await connection.execute('DELETE FROM companies WHERE id = ?', [id]);

    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, old_value, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        'DELETE',
        'companies',
        id,
        JSON.stringify(companies[0]),
        getRequestIp(req)
      ]
    );

    res.status(200).json({ message: 'Company deleted successfully' });
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Update company status (Super Admin only)
const updateCompanyStatus = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    connection = await pool.getConnection();
    const [companies] = await connection.execute('SELECT status FROM companies WHERE id = ?', [id]);

    if (companies.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    await connection.execute('UPDATE companies SET status = ? WHERE id = ?', [status, id]);

    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, old_value, new_value, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        'STATUS_UPDATE',
        'companies',
        id,
        JSON.stringify({ status: companies[0].status }),
        JSON.stringify({ status }),
        getRequestIp(req)
      ]
    );

    res.status(200).json({ message: 'Company status updated successfully' });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  getAllCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  updateCompanyStatus
};
