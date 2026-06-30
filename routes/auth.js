const express = require('express');
const { login, changePassword, logout, forgotPassword, resetPassword, refreshToken } = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/change-password', verifyToken, changePassword);
router.post('/logout', verifyToken, logout);

module.exports = router;
