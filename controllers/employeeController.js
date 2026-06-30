const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { validateEmployee } = require('../validators/employee');

const canAccessCompany = (req, companyId) => req.user.role === 'super_admin' || Number(req.user.company_id) === Number(companyId);

const IMPORT_HEADERS = ['employee_id', 'name', 'email', 'password', 'mobile', 'designation', 'company_id', 'department_id', 'role', 'status'];

const getCellText = (cell) => {
  if (cell.value && typeof cell.value === 'object') {
    return String(cell.value.text || cell.value.result || '').trim();
  }
  return String(cell.value ?? '').trim();
};

const styleWorkbookHeader = (row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  row.alignment = { vertical: 'middle' };
  row.height = 24;
};

const buildFilters = (query, params) => {
  const clauses = [];

  if (query.search) {
    clauses.push('(u.name LIKE ? OR u.employee_id LIKE ? OR u.email LIKE ?)');
    const term = `%${query.search}%`;
    params.push(term, term, term);
  }

  if (query.company_id) {
    clauses.push('u.company_id = ?');
    params.push(query.company_id);
  }

  if (query.department_id) {
    clauses.push('u.department_id = ?');
    params.push(query.department_id);
  }

  if (query.status) {
    clauses.push('u.status = ?');
    params.push(query.status);
  }

  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
};

const getEmployeeLookup = async (req, res) => {
  let connection;
  try {
    const filters = { status: 'active' };

    if (req.query.company_id) {
      filters.company_id = req.query.company_id;
    }
    if (req.query.department_id) {
      filters.department_id = req.query.department_id;
    }


    const params = [];
    const whereClause = buildFilters(filters, params);
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `SELECT u.id, u.employee_id, u.name, u.email, u.company_id, u.department_id, c.company_name, d.department_name
       FROM users u
       JOIN companies c ON u.company_id = c.id
       JOIN departments d ON u.department_id = d.id
       ${whereClause}
       ORDER BY u.name ASC`,
      params
    );
    res.json({ message: 'Employee lookup retrieved successfully', data: rows });
  } catch (error) {
    console.error('Employee lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const getAllEmployees = async (req, res) => {
  let connection;
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const filters = { ...req.query };

    if (req.user.role === 'company_admin' && !filters.company_id) {
      filters.company_id = req.user.company_id;
    }

    const params = [];
    const whereClause = buildFilters(filters, params);
    connection = await pool.getConnection();

    const [countRows] = await connection.execute(`SELECT COUNT(*) AS total FROM users u ${whereClause}`, params);
    const [rows] = await connection.query(
      `SELECT u.id, u.employee_id, u.name, u.email, u.mobile, u.designation, u.role, u.status, u.company_id, u.department_id, u.last_login, u.created_at, u.updated_at, c.company_name, d.department_name
       FROM users u
       JOIN companies c ON u.company_id = c.id
       JOIN departments d ON u.department_id = d.id
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      message: 'Employees retrieved successfully',
      data: rows,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        totalPages: Math.ceil(countRows[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const createEmployee = async (req, res) => {
  let connection;
  try {
    if (!req.body.password) {
      return res.status(400).json({ error: 'Password is required for new employees' });
    }
    const { error } = validateEmployee(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const payload = req.body;
    if (req.user.role === 'company_admin' && Number(req.user.company_id) !== Number(payload.company_id)) {
      return res.status(403).json({ error: 'You can only manage your company employees' });
    }
    if (req.user.role === 'company_admin' && payload.role === 'super_admin') {
      return res.status(403).json({ error: 'Company admins cannot create super admins' });
    }

    connection = await pool.getConnection();
    const [duplicateRows] = await connection.execute('SELECT id FROM users WHERE employee_id = ? OR email = ?', [payload.employee_id, payload.email]);
    if (duplicateRows.length) {
      return res.status(400).json({ error: 'Employee ID or email already exists' });
    }

    const [companyRows] = await connection.execute('SELECT id FROM companies WHERE id = ? AND status = "active"', [payload.company_id]);
    if (!companyRows.length) {
      return res.status(400).json({ error: 'Company not found or inactive' });
    }

    const [departmentRows] = await connection.execute('SELECT id FROM departments WHERE id = ? AND company_id = ? AND status = "active"', [payload.department_id, payload.company_id]);
    if (!departmentRows.length) {
      return res.status(400).json({ error: 'Department not found, inactive, or not in selected company' });
    }

    const hashedPassword = await bcrypt.hash(payload.password, 10);
    const [result] = await connection.execute(
      'INSERT INTO users (employee_id, name, email, password, mobile, designation, company_id, department_id, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [payload.employee_id, payload.name, payload.email, hashedPassword, payload.mobile || null, payload.designation || null, payload.company_id, payload.department_id, payload.role || 'employee', payload.status || 'active']
    );

    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, new_value, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'CREATE', 'users', result.insertId, JSON.stringify({ ...payload, password: '[hidden]' }), req.ip || req.connection.remoteAddress]
    );

    res.status(201).json({ message: 'Employee created successfully', data: { id: result.insertId } });
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const updateEmployee = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [existingRows] = await connection.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!existingRows.length) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const existing = existingRows[0];
    if (!canAccessCompany(req, existing.company_id)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (req.user.role === 'company_admin' && (existing.role === 'super_admin' || req.body.role === 'super_admin')) {
      return res.status(403).json({ error: 'Company admins cannot manage super admins' });
    }

    const validationTarget = {
      employee_id: req.body.employee_id ?? existing.employee_id,
      name: req.body.name ?? existing.name,
      email: req.body.email ?? existing.email,
      mobile: req.body.mobile ?? existing.mobile,
      designation: req.body.designation ?? existing.designation,
      company_id: req.body.company_id ?? existing.company_id,
      department_id: req.body.department_id ?? existing.department_id,
      role: req.body.role ?? existing.role,
      status: req.body.status ?? existing.status
    };

    if (req.body.password) {
      validationTarget.password = req.body.password;
    }

    const { error } = validateEmployee(validationTarget);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    if (req.body.company_id && req.body.company_id !== existing.company_id && req.user.role === 'company_admin') {
      return res.status(403).json({ error: 'You can only manage your company employees' });
    }

    const [duplicateRows] = await connection.execute('SELECT id FROM users WHERE (employee_id = ? OR email = ?) AND id <> ?', [validationTarget.employee_id, validationTarget.email, req.params.id]);
    if (duplicateRows.length) {
      return res.status(400).json({ error: 'Employee ID or email already exists' });
    }

    if (req.body.password) {
      validationTarget.password = await bcrypt.hash(req.body.password, 10);
    } else {
      validationTarget.password = existing.password;
    }

    await connection.execute(
      'UPDATE users SET employee_id = ?, name = ?, email = ?, password = ?, mobile = ?, designation = ?, company_id = ?, department_id = ?, role = ?, status = ? WHERE id = ?',
      [validationTarget.employee_id, validationTarget.name, validationTarget.email, validationTarget.password, validationTarget.mobile || null, validationTarget.designation || null, validationTarget.company_id, validationTarget.department_id, validationTarget.role, validationTarget.status, req.params.id]
    );

    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, old_value, new_value, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, 'UPDATE', 'users', req.params.id, JSON.stringify(existing), JSON.stringify({ ...validationTarget, password: '[hidden]' }), req.ip || req.connection.remoteAddress]
    );

    res.json({ message: 'Employee updated successfully' });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const updateEmployeeStatus = async (req, res) => {
  let connection;
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT id, company_id, status FROM users WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (!canAccessCompany(req, rows[0].company_id)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await connection.execute('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, old_value, new_value, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, 'STATUS_UPDATE', 'users', req.params.id, JSON.stringify({ status: rows[0].status }), JSON.stringify({ status }), req.ip || req.connection.remoteAddress]
    );

    res.json({ message: 'Employee status updated successfully' });
  } catch (error) {
    console.error('Update employee status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const deleteEmployee = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (!canAccessCompany(req, rows[0].company_id)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await connection.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
    await connection.execute('INSERT INTO audit_logs (user_id, action, module, record_id, old_value, ip_address) VALUES (?, ?, ?, ?, ?, ?)', [req.user.id, 'DELETE', 'users', req.params.id, JSON.stringify(rows[0]), req.ip || req.connection.remoteAddress]);

    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const importEmployees = async (req, res) => {
  let connection;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Excel file is required' });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ error: 'Excel sheet is empty' });

    const actualHeaders = IMPORT_HEADERS.map((_, index) => getCellText(sheet.getRow(1).getCell(index + 1)).toLowerCase());
    if (actualHeaders.some((header, index) => header !== IMPORT_HEADERS[index])) {
      return res.status(400).json({ error: `Invalid template. Expected headers: ${IMPORT_HEADERS.join(', ')}` });
    }

    connection = await pool.getConnection();
    const imported = [];
    const errors = [];

    for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      const employee = {
        employee_id: getCellText(row.getCell(1)),
        name: getCellText(row.getCell(2)),
        email: getCellText(row.getCell(3)),
        password: getCellText(row.getCell(4)),
        mobile: getCellText(row.getCell(5)),
        designation: getCellText(row.getCell(6)),
        company_id: Number(getCellText(row.getCell(7))),
        department_id: Number(getCellText(row.getCell(8))),
        role: getCellText(row.getCell(9)) || 'employee',
        status: getCellText(row.getCell(10)) || 'active'
      };

      if (!employee.employee_id && !employee.name && !employee.email) continue;

      if (!employee.password) {
        errors.push({ row: rowIndex, message: 'Password is required' });
        continue;
      }

      if (!canAccessCompany(req, employee.company_id)) {
        errors.push({ row: rowIndex, message: 'You cannot import employees for this company' });
        continue;
      }

      if (req.user.role === 'company_admin' && employee.role === 'super_admin') {
        errors.push({ row: rowIndex, message: 'Company admins cannot import super admins' });
        continue;
      }

      const { error } = validateEmployee(employee);
      if (error) {
        errors.push({ row: rowIndex, message: error.details[0].message });
        continue;
      }

      const [companyRows] = await connection.execute('SELECT id FROM companies WHERE id = ? AND status = "active"', [employee.company_id]);
      const [departmentRows] = await connection.execute('SELECT id FROM departments WHERE id = ? AND company_id = ? AND status = "active"', [employee.department_id, employee.company_id]);
      const [dupRows] = await connection.execute('SELECT id FROM users WHERE employee_id = ? OR email = ?', [employee.employee_id, employee.email]);

      if (!companyRows.length) {
        errors.push({ row: rowIndex, message: 'Company ID is invalid or inactive' });
        continue;
      }
      if (!departmentRows.length) {
        errors.push({ row: rowIndex, message: 'Department ID is invalid, inactive, or belongs to another company' });
        continue;
      }
      if (dupRows.length) {
        errors.push({ row: rowIndex, message: 'Employee ID or email already exists' });
        continue;
      }

      const hashedPassword = await bcrypt.hash(employee.password, 10);
      const [result] = await connection.execute(
        'INSERT INTO users (employee_id, name, email, password, mobile, designation, company_id, department_id, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [employee.employee_id, employee.name, employee.email, hashedPassword, employee.mobile || null, employee.designation || null, employee.company_id, employee.department_id, employee.role, employee.status]
      );
      imported.push(result.insertId);
    }

    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, new_value, ip_address) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'IMPORT', 'users', JSON.stringify({ imported_count: imported.length, errors: errors.length }), req.ip || req.connection.remoteAddress]
    );

    res.status(200).json({ message: 'Employee import completed', data: { importedCount: imported.length, errors } });
  } catch (error) {
    console.error('Import employees error:', error);
    res.status(400).json({ error: error.message || 'Unable to import employees' });
  } finally {
    if (connection) connection.release();
  }
};

const downloadImportTemplate = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const companyFilter = req.user.role === 'company_admin'
      ? "WHERE c.id = ? AND c.status = 'active' AND d.status = 'active'"
      : "WHERE c.status = 'active' AND d.status = 'active'";
    const params = req.user.role === 'company_admin' ? [req.user.company_id] : [];
    const [references] = await connection.execute(
      `SELECT c.id AS company_id, c.company_name, d.id AS department_id, d.department_name
       FROM companies c
       JOIN departments d ON c.id = d.company_id
       ${companyFilter}
       ORDER BY c.company_name, d.department_name`,
      params
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Feedback-Rating App';
    const sheet = workbook.addWorksheet('Employee Import');
    sheet.columns = IMPORT_HEADERS.map((header) => ({ header, key: header, width: header === 'email' ? 30 : 20 }));
    sheet.addRow({ employee_id: 'EMP-1001', name: 'Sample Employee', email: 'sample.employee@example.com', password: 'Welcome@123', mobile: '9876543210', designation: 'Analyst', company_id: references[0]?.company_id || 1, department_id: references[0]?.department_id || 1, role: 'employee', status: 'active' });
    styleWorkbookHeader(sheet.getRow(1));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = `A1:J1`;

    const instructions = workbook.addWorksheet('Instructions');
    instructions.columns = [{ width: 24 }, { width: 85 }];
    instructions.addRows([
      ['Field', 'Requirement'],
      ['employee_id', 'Required and unique. Maximum 50 characters.'],
      ['name', 'Required. 2-255 characters.'],
      ['email', 'Required, valid, and unique.'],
      ['password', 'At least 8 characters with uppercase, lowercase, number, and @$!%*?&.'],
      ['mobile', 'Optional. Maximum 20 characters.'],
      ['designation', 'Optional. Maximum 100 characters.'],
      ['company_id', 'Required numeric ID from the Reference sheet.'],
      ['department_id', 'Required numeric ID from the Reference sheet; must belong to company_id.'],
      ['role', 'employee or company_admin. Super admins may also use super_admin.'],
      ['status', 'active or inactive.'],
      ['Important', 'Keep the header row unchanged. Delete the sample row before importing real employees.']
    ]);
    styleWorkbookHeader(instructions.getRow(1));

    const referenceSheet = workbook.addWorksheet('Company & Department IDs');
    referenceSheet.columns = [
      { header: 'company_id', key: 'company_id', width: 14 },
      { header: 'company_name', key: 'company_name', width: 30 },
      { header: 'department_id', key: 'department_id', width: 16 },
      { header: 'department_name', key: 'department_name', width: 30 }
    ];
    referenceSheet.addRows(references);
    styleWorkbookHeader(referenceSheet.getRow(1));
    referenceSheet.views = [{ state: 'frozen', ySplit: 1 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=employee-import-template.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Employee template error:', error);
    res.status(500).json({ error: 'Unable to generate import template' });
  } finally {
    if (connection) connection.release();
  }
};

const exportEmployees = async (req, res) => {
  let connection;
  try {
    const filters = { ...req.query };
    if (req.user.role === 'company_admin' && !filters.company_id) {
      filters.company_id = req.user.company_id;
    }

    const params = [];
    const whereClause = buildFilters(filters, params);
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `SELECT u.employee_id, u.name, u.email, u.mobile, u.designation, c.company_name, d.department_name, u.role, u.status, u.created_at
       FROM users u
       JOIN companies c ON u.company_id = c.id
       JOIN departments d ON u.department_id = d.id
       ${whereClause}
       ORDER BY u.created_at DESC`,
      params
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Employees');
    sheet.columns = [
      { header: 'Employee ID', key: 'employee_id', width: 18 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Mobile', key: 'mobile', width: 18 },
      { header: 'Designation', key: 'designation', width: 20 },
      { header: 'Company', key: 'company_name', width: 25 },
      { header: 'Department', key: 'department_name', width: 25 },
      { header: 'Role', key: 'role', width: 18 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Created At', key: 'created_at', width: 22 }
    ];
    sheet.addRows(rows);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=employees.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export employees error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const resetEmployeePassword = async (req, res) => {
  let connection;
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT id, company_id FROM users WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (!canAccessCompany(req, rows[0].company_id)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await connection.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.params.id]);
    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, module, record_id, new_value, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'RESET_PASSWORD', 'users', req.params.id, JSON.stringify({ reset: true }), req.ip || req.connection.remoteAddress]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset employee password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = { getEmployeeLookup, getAllEmployees, createEmployee, updateEmployee, updateEmployeeStatus, resetEmployeePassword, deleteEmployee, importEmployees, exportEmployees, downloadImportTemplate };
