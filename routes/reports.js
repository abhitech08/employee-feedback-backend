const express = require('express');
const { verifyToken, isAdminOrSuperAdmin, isSuperAdmin } = require('../middleware/auth');
const { getEmployeeFeedbackReport, getCompanyReport, getDepartmentReport } = require('../controllers/reportController');

const router = express.Router();

router.use(verifyToken);
router.get('/employee-feedback', isAdminOrSuperAdmin, getEmployeeFeedbackReport);
router.get('/company', isSuperAdmin, getCompanyReport);
router.get('/department', isAdminOrSuperAdmin, getDepartmentReport);

module.exports = router;
