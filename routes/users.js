const express = require('express');
const multer = require('multer');
const {
  getAllEmployees,
  getEmployeeLookup,
  createEmployee,
  updateEmployee,
  updateEmployeeStatus,
  resetEmployeePassword,
  deleteEmployee,
  importEmployees,
  exportEmployees
} = require('../controllers/employeeController');
const { verifyToken, isSuperAdmin } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken, isSuperAdmin);
router.get('/lookup', getEmployeeLookup);
router.get('/export', exportEmployees);
router.get('/', getAllEmployees);
router.post('/', createEmployee);
router.post('/import', upload.single('file'), importEmployees);
router.put('/:id', updateEmployee);
router.patch('/:id/status', updateEmployeeStatus);
router.post('/:id/reset-password', resetEmployeePassword);
router.delete('/:id', deleteEmployee);

module.exports = router;