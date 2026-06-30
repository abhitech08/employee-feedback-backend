const express = require('express');
const {
  getAllCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  updateCompanyStatus
} = require('../controllers/companyController');
const { verifyToken, isSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// All company routes require authentication
router.use(verifyToken);

// Read-only company list is available to authenticated users for feedback recipient lookup.
router.get('/', getAllCompanies);
router.get('/:id', isSuperAdmin, getCompanyById);
router.post('/', isSuperAdmin, createCompany);
router.put('/:id', isSuperAdmin, updateCompany);
router.delete('/:id', isSuperAdmin, deleteCompany);
router.patch('/:id/status', isSuperAdmin, updateCompanyStatus);

module.exports = router;
