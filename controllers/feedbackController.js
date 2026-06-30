const pool = require('../config/database');

const calculateAverage = (ratings) => {
  const values = [ratings.communication, ratings.teamwork, ratings.respect, ratings.responsibility, ratings.leadership].map(Number);
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
};

const createFeedback = async (req, res) => {
  let connection;
  try {
    const { given_to, communication, teamwork, respect, responsibility, leadership, comment, is_anonymous, company_id, department_id } = req.body;

    if (!given_to || !communication || !teamwork || !respect || !responsibility || !leadership) {
      return res.status(400).json({ error: 'All rating fields and recipient are required' });
    }

    connection = await pool.getConnection();

    const [giverRows] = await connection.execute('SELECT id FROM users WHERE id = ? AND status = "active"', [req.user.id]);
    const [receiverRows] = await connection.execute(
      'SELECT id, company_id, department_id, status FROM users WHERE id = ? AND status = "active"',
      [given_to]
    );

    if (!giverRows.length || !receiverRows.length) {
      return res.status(400).json({ error: 'Invalid giver or receiver' });
    }

    if (Number(given_to) === Number(req.user.id)) {
      return res.status(400).json({ error: 'Self feedback is not allowed' });
    }

    // SECURITY: do not trust company_id/department_id from client.
    // Validate that the selected employee belongs to selected company & department.
    const selectedCompanyId = company_id ? Number(company_id) : null;
    const selectedDepartmentId = department_id ? Number(department_id) : null;

    if (!selectedCompanyId || !selectedDepartmentId) {
      return res.status(400).json({ error: 'Company and Department selections are required' });
    }

    const employeeCompanyId = Number(receiverRows[0].company_id);
    const employeeDepartmentId = Number(receiverRows[0].department_id);

    if (employeeCompanyId !== selectedCompanyId || employeeDepartmentId !== selectedDepartmentId) {
      return res.status(400).json({ error: 'Selected employee does not belong to the selected company and department' });
    }

    const [duplicateRows] = await connection.execute(
      `SELECT id FROM feedback
       WHERE given_by = ?
         AND given_to = ?
         AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)`,
      [req.user.id, given_to]
    );

    if (duplicateRows.length) {
      return res.status(400).json({ error: 'Feedback already given for this employee this month' });
    }

    const overall_rating = calculateAverage({ communication, teamwork, respect, responsibility, leadership });

    // Store actual company_id/department_id from the employee record.
    const [result] = await connection.execute(
      `INSERT INTO feedback (given_by, given_to, company_id, department_id, communication, teamwork, respect, responsibility, leadership, overall_rating, comment, is_anonymous)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        given_to,
        employeeCompanyId,
        employeeDepartmentId,
        communication,
        teamwork,
        respect,
        responsibility,
        leadership,
        overall_rating,
        comment || null,
        Boolean(is_anonymous)
      ]
    );

    res.status(201).json({ message: 'Feedback submitted successfully', data: { id: result.insertId, overall_rating } });
  } catch (error) {
    console.error('Create feedback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const protectAnonymousIdentity = (rows, role) => rows.map((row) => {
  if (!row.is_anonymous || role === 'super_admin') return row;
  const protectedRow = { ...row, given_by_name: 'Anonymous user' };
  delete protectedRow.given_by;
  return protectedRow;
});

const getMyFeedback = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `SELECT f.*, giver.name AS given_by_name, receiver.name AS given_to_name, c.company_name, d.department_name
       FROM feedback f
       JOIN users giver ON f.given_by = giver.id
       JOIN users receiver ON f.given_to = receiver.id
       JOIN companies c ON f.company_id = c.id
       JOIN departments d ON f.department_id = d.id
       WHERE f.given_by = ? OR f.given_to = ?
       ORDER BY f.created_at DESC`,
      [req.user.id, req.user.id]
    );
    res.json({ message: 'Feedback retrieved successfully', data: protectAnonymousIdentity(rows, req.user.role) });
  } catch (error) {
    console.error('Get my feedback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const getFeedbackHistory = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `SELECT f.*, giver.name AS given_by_name, receiver.name AS given_to_name, c.company_name, d.department_name
       FROM feedback f
       JOIN users giver ON f.given_by = giver.id
       JOIN users receiver ON f.given_to = receiver.id
       JOIN companies c ON f.company_id = c.id
       JOIN departments d ON f.department_id = d.id
       WHERE f.given_by = ? OR f.given_to = ?
       ORDER BY f.created_at DESC`,
      [req.user.id, req.user.id]
    );
    res.json({ message: 'Feedback history retrieved successfully', data: protectAnonymousIdentity(rows, req.user.role) });
  } catch (error) {
    console.error('Get feedback history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = { createFeedback, getMyFeedback, getFeedbackHistory };
