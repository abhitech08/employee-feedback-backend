const ExcelJS = require('exceljs');
const pool = require('../config/database');

const protectAnonymousIdentity = (rows, role) => rows.map((row) => {
  if (!row.is_anonymous || role === 'super_admin') return row;
  const protectedRow = { ...row, given_by_name: 'Anonymous user' };
  delete protectedRow.given_by;
  return protectedRow;
});

const maybeExportExcel = async (req, res, rows, sheetName, filename, columns) => {
  if (String(req.query.format).toLowerCase() !== 'excel') {
    return null;
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns;
  sheet.addRows(rows);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  await workbook.xlsx.write(res);
  res.end();
  return true;
};

const getEmployeeFeedbackReport = async (req, res) => {
  let connection;
  try {
    const filters = [];
    const params = [];

    if (req.query.company_id) {
      filters.push('f.company_id = ?');
      params.push(req.query.company_id);
    }
    if (req.query.department_id) {
      filters.push('f.department_id = ?');
      params.push(req.query.department_id);
    }
    if (req.query.employee_id) {
      filters.push('f.given_to = ?');
      params.push(req.query.employee_id);
    }
    if (req.query.start_date) {
      filters.push('DATE(f.created_at) >= ?');
      params.push(req.query.start_date);
    }
    if (req.query.end_date) {
      filters.push('DATE(f.created_at) <= ?');
      params.push(req.query.end_date);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `SELECT f.*, giver.name AS given_by_name, receiver.name AS given_to_name, c.company_name, d.department_name
       FROM feedback f
       JOIN users giver ON f.given_by = giver.id
       JOIN users receiver ON f.given_to = receiver.id
       JOIN companies c ON f.company_id = c.id
       JOIN departments d ON f.department_id = d.id
       ${whereClause}
       ORDER BY f.created_at DESC`,
      params
    );
    const visibleRows = protectAnonymousIdentity(rows, req.user.role);

    if (await maybeExportExcel(req, res, visibleRows, 'Feedback-Rating App', 'feedback-rating-app-report.xlsx', [
      { header: 'Given By', key: 'given_by_name', width: 22 },
      { header: 'Given To', key: 'given_to_name', width: 22 },
      { header: 'Company', key: 'company_name', width: 22 },
      { header: 'Department', key: 'department_name', width: 22 },
      { header: 'Communication', key: 'communication', width: 14 },
      { header: 'Teamwork', key: 'teamwork', width: 14 },
      { header: 'Respect', key: 'respect', width: 14 },
      { header: 'Responsibility', key: 'responsibility', width: 14 },
      { header: 'Leadership', key: 'leadership', width: 14 },
      { header: 'Overall Rating', key: 'overall_rating', width: 14 },
      { header: 'Comment', key: 'comment', width: 40 },
      { header: 'Date', key: 'created_at', width: 20 }
    ])) return;

    res.json({ data: visibleRows });
  } catch (error) {
    console.error('Employee report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const getCompanyReport = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `WITH user_counts AS (
         SELECT company_id, COUNT(*) AS employee_count
         FROM users
         GROUP BY company_id
       ),
       feedback_stats AS (
         SELECT company_id, COUNT(*) AS feedback_count, ROUND(AVG(overall_rating), 2) AS company_score
         FROM feedback
         GROUP BY company_id
       )
       SELECT c.id, c.company_name,
        COALESCE(uc.employee_count, 0) AS employee_count,
        COALESCE(fs.feedback_count, 0) AS feedback_count,
        fs.company_score
       FROM companies c
       LEFT JOIN user_counts uc ON c.id = uc.company_id
       LEFT JOIN feedback_stats fs ON c.id = fs.company_id
       ORDER BY company_score DESC`
    );

    if (await maybeExportExcel(req, res, rows, 'Company Report', 'company-report.xlsx', [
      { header: 'Company', key: 'company_name', width: 24 },
      { header: 'Employee Count', key: 'employee_count', width: 16 },
      { header: 'Feedback Count', key: 'feedback_count', width: 16 },
      { header: 'Company Score', key: 'company_score', width: 14 }
    ])) return;

    res.json({ data: rows });
  } catch (error) {
    console.error('Company report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const getDepartmentReport = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `WITH user_counts AS (
         SELECT department_id, COUNT(*) AS employee_count
         FROM users
         GROUP BY department_id
       ),
       feedback_stats AS (
         SELECT department_id, COUNT(*) AS feedback_count, ROUND(AVG(overall_rating), 2) AS department_score
         FROM feedback
         GROUP BY department_id
       )
       SELECT d.id, d.department_name, c.company_name,
        COALESCE(uc.employee_count, 0) AS employee_count,
        COALESCE(fs.feedback_count, 0) AS feedback_count,
        fs.department_score
       FROM departments d
       JOIN companies c ON d.company_id = c.id
       LEFT JOIN user_counts uc ON d.id = uc.department_id
       LEFT JOIN feedback_stats fs ON d.id = fs.department_id
       ORDER BY department_score DESC`
    );

    if (await maybeExportExcel(req, res, rows, 'Department Report', 'department-report.xlsx', [
      { header: 'Department', key: 'department_name', width: 24 },
      { header: 'Company', key: 'company_name', width: 24 },
      { header: 'Employee Count', key: 'employee_count', width: 16 },
      { header: 'Feedback Count', key: 'feedback_count', width: 16 },
      { header: 'Department Score', key: 'department_score', width: 18 }
    ])) return;

    res.json({ data: rows });
  } catch (error) {
    console.error('Department report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = { getEmployeeFeedbackReport, getCompanyReport, getDepartmentReport };
