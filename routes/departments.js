const express = require('express');
const {
  getAllDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment
} = require('../controllers/departmentController');
const { verifyToken, isAdminOrSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// All department routes require authentication
router.use(verifyToken);

// Read-only department list is available to authenticated users for feedback recipient lookup.
router.get('/', getAllDepartments);
router.get('/:id', isAdminOrSuperAdmin, getDepartmentById);
router.post('/', isAdminOrSuperAdmin, createDepartment);
router.put('/:id', isAdminOrSuperAdmin, updateDepartment);
router.delete('/:id', isAdminOrSuperAdmin, deleteDepartment);

module.exports = router;
