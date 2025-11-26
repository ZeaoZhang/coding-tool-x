const express = require('express');
const router = express.Router();
const {
  addFavorite,
  removeFavorite,
  isFavorite,
  getFavorites,
  getAllFavorites
} = require('../services/favorites');

// Get all favorites
router.get('/', (req, res) => {
  try {
    const favorites = getAllFavorites();
    res.json({ success: true, favorites });
  } catch (error) {
    console.error('Error getting favorites:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get favorites for a specific channel
router.get('/:channel', (req, res) => {
  try {
    const { channel } = req.params;
    const favorites = getFavorites(channel);
    res.json({ success: true, favorites });
  } catch (error) {
    console.error('Error getting channel favorites:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a favorite
router.post('/', (req, res) => {
  try {
    const { channel, sessionData } = req.body;

    if (!channel || !sessionData) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = addFavorite(channel, sessionData);
    res.json(result);
  } catch (error) {
    console.error('Error adding favorite:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove a favorite
router.delete('/:channel/:projectName/:sessionId', (req, res) => {
  try {
    const { channel, projectName, sessionId } = req.params;

    const result = removeFavorite(channel, decodeURIComponent(projectName), sessionId);
    res.json(result);
  } catch (error) {
    console.error('Error removing favorite:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check if favorited
router.get('/check/:channel/:projectName/:sessionId', (req, res) => {
  try {
    const { channel, projectName, sessionId } = req.params;

    const favorited = isFavorite(channel, decodeURIComponent(projectName), sessionId);
    res.json({ success: true, isFavorite: favorited });
  } catch (error) {
    console.error('Error checking favorite:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
