const express = require('express');
const { verifyToken, isAdminOrSuperAdmin } = require('../middleware/auth');
const { getEmployeeDashboard, getCompanyAdminDashboard, getSuperAdminDashboard } = require('../controllers/dashboardController');

const router = express.Router();

router.use(verifyToken);
router.get('/employee', getEmployeeDashboard);
router.get('/company', isAdminOrSuperAdmin, getCompanyAdminDashboard);
router.get('/admin', isAdminOrSuperAdmin, getSuperAdminDashboard);

module.exports = router;