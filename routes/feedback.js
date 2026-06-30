const express = require('express');
const { createFeedback, getMyFeedback, getFeedbackHistory } = require('../controllers/feedbackController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);
router.post('/', createFeedback);
router.get('/my', getMyFeedback);
router.get('/history', getFeedbackHistory);

module.exports = router;