const express = require('express');
const multer = require('multer');
const { getEmployeeLookup, getAllEmployees, createEmployee, updateEmployee, updateEmployeeStatus, deleteEmployee, importEmployees, exportEmployees, downloadImportTemplate } = require('../controllers/employeeController');
const { verifyToken, isAdminOrSuperAdmin } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const validExtension = /\.xlsx$/i.test(file.originalname);
    if (!validExtension) return callback(new Error('Only .xlsx files are supported'));
    callback(null, true);
  }
});

router.use(verifyToken);
router.get('/export', isAdminOrSuperAdmin, exportEmployees);
router.get('/import-template', isAdminOrSuperAdmin, downloadImportTemplate);
router.get('/lookup', getEmployeeLookup);
router.get('/', isAdminOrSuperAdmin, getAllEmployees);
router.post('/import', isAdminOrSuperAdmin, upload.single('file'), importEmployees);
router.post('/', isAdminOrSuperAdmin, createEmployee);
router.put('/:id', isAdminOrSuperAdmin, updateEmployee);
router.patch('/:id/status', isAdminOrSuperAdmin, updateEmployeeStatus);
router.delete('/:id', isAdminOrSuperAdmin, deleteEmployee);

module.exports = router;
