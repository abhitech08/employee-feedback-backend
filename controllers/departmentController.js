const pool = require('../config/database');
const { validateDepartment } = require('../validators/department');

const getRequestIp = (req) => req.ip || req.connection.remoteAddress;

// Get all departments (with optional company filter)
const getAllDepartments = async (req, res) => {
  let connection;
  try {
    const { company_id } = req.query;
    const params = [];
    let query = 'SELECT d.*, c.company_name FROM departments d JOIN companies c ON d.company_id = c.id';

    if (company_id) {
      query += ' WHERE d.company_id = ?';
      params.push(company_id);
    }

    query += ' ORDER BY d.created_at DESC';
    connection = await pool.getConnection();
    const [departments] = await connection.execute(query, params);

    res.status(200).json({
      message: 'Departments retrieved successfully',
      data: departments
    });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Get department by ID
const getDepartmentById = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [departments] = await connection.execute(
      'SELECT d.*, c.company_name FROM departments d JOIN companies c ON d.company_id = c.id WHERE d.id = ?',
      [req.params.id]
    );

    if (departments.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.status(200).json({
      message: 'Department retrieved successfully',
      data: departments[0]
    });
  } catch (error) {
    console.error('Get department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Create department (Super Admin or Company Admin)
const createDepartment = async (req, res) => {
  let connection;
  try {
    const { company_id, department_name } = req.body;
    const { error } = validateDepartment({ company_id, department_name });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    if (req.user.role === 'company_admin' && Number(req.user.company_id) !== Number(company_id)) {
      return res.status(403).json({ error: 'You can only manage your company departments' });
    }

    connection = await pool.getConnection();
    const [companies] = await connection.execute('SELECT id FROM companies WHERE id = ?', [company_id]);

    if (companies.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const [existing] = await connection.execute(
      'SELECT id FROM departments WHERE company_id = ? AND department_name = ?',
      [company_id, department_name]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Department already exists for this company' });
    }

    const [result] = await connection.execute(
      'INSERT INTO departments (company_id, department_name) VALUES (?, ?)',
      [company_id, department_name]
    );

    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, new_value, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        'CREATE',
        'departments',
        result.insertId,
        JSON.stringify({ company_id, department_name }),
        getRequestIp(req)
      ]
    );

    res.status(201).json({
      message: 'Department created successfully',
      data: { id: result.insertId, company_id, department_name, status: 'active' }
    });
  } catch (error) {
    console.error('Create department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Update department
const updateDepartment = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { department_name, status } = req.body;

    connection = await pool.getConnection();
    const [existing] = await connection.execute('SELECT * FROM departments WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    if (req.user.role === 'company_admin' && Number(req.user.company_id) !== Number(existing[0].company_id)) {
      return res.status(403).json({ error: 'You can only manage your company departments' });
    }

    const oldValue = existing[0];
    const nextValue = {
      department_name: department_name || oldValue.department_name,
      status: status || oldValue.status
    };

    await connection.execute(
      'UPDATE departments SET department_name = ?, status = ? WHERE id = ?',
      [nextValue.department_name, nextValue.status, id]
    );

    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, old_value, new_value, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        'UPDATE',
        'departments',
        id,
        JSON.stringify(oldValue),
        JSON.stringify(nextValue),
        getRequestIp(req)
      ]
    );

    res.status(200).json({ message: 'Department updated successfully' });
  } catch (error) {
    console.error('Update department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

// Delete department
const deleteDepartment = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;

    connection = await pool.getConnection();
    const [departments] = await connection.execute('SELECT * FROM departments WHERE id = ?', [id]);

    if (departments.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    if (req.user.role === 'company_admin' && Number(req.user.company_id) !== Number(departments[0].company_id)) {
      return res.status(403).json({ error: 'You can only manage your company departments' });
    }

    const [users] = await connection.execute('SELECT COUNT(*) as count FROM users WHERE department_id = ?', [id]);

    if (Number(users[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete department with active employees' });
    }

    await connection.execute('DELETE FROM departments WHERE id = ?', [id]);

    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, old_value, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        'DELETE',
        'departments',
        id,
        JSON.stringify(departments[0]),
        getRequestIp(req)
      ]
    );

    res.status(200).json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Delete department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  getAllDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment
};
