const pool = require('../config/database');

const protectAnonymousIdentity = (rows, role) => rows.map((row) => {
  if (!row.is_anonymous || role === 'super_admin') return row;
  const protectedRow = { ...row, given_by_name: 'Anonymous user' };
  delete protectedRow.given_by;
  return protectedRow;
});

const getEmployeeDashboard = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const userId = req.user.id;

    const [cards] = await connection.execute(
      `SELECT
        (SELECT COUNT(*) FROM feedback WHERE given_to = ?) AS feedback_received,

        (SELECT ROUND(AVG(overall_rating), 2) FROM feedback WHERE given_to = ?) AS average_rating`,
      [userId, userId]
    );

    const [latestFeedback] = await connection.execute(
      `SELECT f.*, giver.name AS given_by_name
       FROM feedback f
       JOIN users giver ON f.given_by = giver.id
       WHERE f.given_to = ?
       ORDER BY f.created_at DESC
       LIMIT 5`,
      [userId]
    );

    const [trend] = await connection.execute(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, ROUND(AVG(overall_rating), 2) AS average_rating
       FROM feedback
       WHERE given_to = ?
       GROUP BY TO_CHAR(created_at, 'YYYY-MM')
       ORDER BY month ASC`,
      [userId]
    );

    const [category] = await connection.execute(
      `SELECT
        ROUND(AVG(communication), 2) AS communication,
        ROUND(AVG(teamwork), 2) AS teamwork,
        ROUND(AVG(respect), 2) AS respect,
        ROUND(AVG(responsibility), 2) AS responsibility,
        ROUND(AVG(leadership), 2) AS leadership
       FROM feedback
       WHERE given_to = ?`,
      [userId]
    );

    res.json({
      cards: cards[0],
      latestFeedback: protectAnonymousIdentity(latestFeedback, req.user.role),
      trend,
      category: category[0]
    });
  } catch (error) {
    console.error('Employee dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const getCompanyAdminDashboard = async (req, res) => {
  let connection;
  try {
    const companyId = req.user.company_id;
    connection = await pool.getConnection();

    const [cards] = await connection.execute(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE company_id = ?) AS employees,
        (SELECT COUNT(*) FROM departments WHERE company_id = ?) AS departments,
        (SELECT COUNT(*) FROM feedback WHERE company_id = ?) AS feedback_count,

        (SELECT ROUND(AVG(overall_rating), 2) FROM feedback WHERE company_id = ?) AS average_score`,
      [companyId, companyId, companyId, companyId]
    );

    const [departmentRanking] = await connection.execute(
      `SELECT d.department_name, COUNT(f.id) AS feedback_count, ROUND(AVG(f.overall_rating), 2) AS average_score
       FROM departments d
       LEFT JOIN feedback f ON d.id = f.department_id
       WHERE d.company_id = ?
       GROUP BY d.id, d.department_name
       ORDER BY average_score DESC`,
      [companyId]
    );

    const [monthlyFeedback] = await connection.execute(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, COUNT(*) AS feedback_count
       FROM feedback
       WHERE company_id = ?
       GROUP BY TO_CHAR(created_at, 'YYYY-MM')
       ORDER BY month ASC`,
      [companyId]
    );

    res.json({ cards: cards[0], departmentRanking, monthlyFeedback });

  } catch (error) {
    console.error('Company dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const getSuperAdminDashboard = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    const [cards] = await connection.execute(
      `SELECT
        (SELECT COUNT(*) FROM companies) AS companies,
        (SELECT COUNT(*) FROM users) AS employees,
        (SELECT COUNT(*) FROM feedback) AS feedback_count,
        (SELECT ROUND(AVG(overall_rating), 2) FROM feedback) AS average_score`
    );

    const [companyRanking] = await connection.execute(
      `SELECT c.company_name,
              COUNT(f.id) AS feedback_count,
              ROUND(AVG(f.overall_rating), 2) AS average_score
       FROM companies c
       LEFT JOIN feedback f ON c.id = f.company_id
       GROUP BY c.id, c.company_name
       ORDER BY average_score DESC`
    );

    const [monthlyFeedback] = await connection.execute(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, COUNT(*) AS feedback_count
       FROM feedback
       GROUP BY TO_CHAR(created_at, 'YYYY-MM')
       ORDER BY month ASC`
    );

    const [categoryAverages] = await connection.execute(
      `SELECT
        ROUND(COALESCE(AVG(communication), 2), 2) AS communication,
        ROUND(COALESCE(AVG(teamwork), 2), 2) AS teamwork,
        ROUND(COALESCE(AVG(respect), 2), 2) AS respect,
        ROUND(COALESCE(AVG(responsibility), 2), 2) AS responsibility,
        ROUND(COALESCE(AVG(leadership), 2), 2) AS leadership
       FROM feedback`
    );

    const [topCompaniesByFeedback] = await connection.execute(
      `SELECT c.company_name, COUNT(f.id) AS feedback_count
       FROM companies c
       JOIN feedback f ON c.id = f.company_id
       GROUP BY c.id, c.company_name
       ORDER BY feedback_count DESC
       LIMIT 10`
    );

    const [topCompaniesByAverageScore] = await connection.execute(
      `SELECT c.company_name,
              COUNT(f.id) AS feedback_count,
              ROUND(AVG(f.overall_rating), 2) AS average_score
       FROM companies c
       JOIN feedback f ON c.id = f.company_id
       GROUP BY c.id, c.company_name
       ORDER BY average_score DESC
       LIMIT 10`
    );

    const [departmentRanking] = await connection.execute(
      `SELECT d.department_name,
              COUNT(f.id) AS feedback_count,
              ROUND(AVG(f.overall_rating), 2) AS average_score
       FROM departments d
       JOIN feedback f ON d.id = f.department_id
       GROUP BY d.id, d.department_name
       ORDER BY average_score DESC
       LIMIT 10`
    );

    const [employeeRanking] = await connection.execute(
      `SELECT u.name AS employee_name,
              COUNT(f.id) AS feedback_received,
              ROUND(AVG(f.overall_rating), 2) AS average_score
       FROM users u
       JOIN feedback f ON u.id = f.given_to
       GROUP BY u.id, u.name
       ORDER BY feedback_received DESC
       LIMIT 10`
    );

    res.json({
      cards: cards[0],
      companyRanking,
      monthlyFeedback,
      categoryAverages: categoryAverages[0],
      topCompaniesByFeedback,
      topCompaniesByAverageScore,
      departmentRanking,
      employeeRanking
    });
  } catch (error) {

    console.error('Super admin dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = { getEmployeeDashboard, getCompanyAdminDashboard, getSuperAdminDashboard };
