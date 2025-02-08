document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup loaded.'); // Debugging

  // Initialize chart
  let chart;
  const ctx = document.getElementById('watchtimeChart')?.getContext('2d');

  // Get elements
  const summaryElement = document.getElementById('watchtimeSummary');
  const settingsButton = document.getElementById('settingsButton');
  const exportButton = document.getElementById('exportButton');
  const emailForm = document.getElementById('emailForm');
  const emailInput = document.getElementById('email');
  const submitEmailButton = document.getElementById('submitEmail');
  const emailError = document.getElementById('emailError');

  // Check if email is registered
  chrome.storage.local.get(['emailRegistered'], (result) => {
    if (!result.emailRegistered) {
      emailForm.style.display = 'block';
    }
  });

  // Handle email submission
  submitEmailButton.addEventListener('click', async () => {
    const email = emailInput.value;
    if (!email) {
      emailError.textContent = 'Please enter a valid email address';
      emailError.style.display = 'block';
      return;
    }

    try {
      const response = await makeAuthenticatedRequest('/register', {
        method: 'POST',
        body: JSON.stringify({
          email: email,
          uniqueIdentifier: await getUniqueIdentifier()
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        await chrome.storage.local.set({ emailRegistered: true });
        emailForm.style.display = 'none';
      } else {
        emailError.textContent = data.error || 'Failed to register email';
        emailError.style.display = 'block';
      }
    } catch (error) {
      console.error('Failed to register email:', error);
      emailError.textContent = 'Failed to register email. Please try again.';
      emailError.style.display = 'block';
    }
  });

  // Function to make authenticated requests
  async function makeAuthenticatedRequest(endpoint, options = {}) {
    const { apiKey } = await chrome.storage.local.get('apiKey');
    if (!apiKey) {
      throw new Error('No API key available');
    }

    const response = await fetch(`https://binge-master.mindthevirt.com${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        ...options.headers
      }
    });

    return response;
  }

  // Function to get unique identifier
  async function getUniqueIdentifier() {
    const result = await chrome.storage.local.get(['uniqueIdentifier']);
    return result.uniqueIdentifier;
  }

  // Retrieve unique identifier
  chrome.storage.local.get(['uniqueIdentifier'], (result) => {
    const uniqueIdentifier = result.uniqueIdentifier;
    console.log('Retrieved unique identifier:', uniqueIdentifier);

    // Function to fetch watchtime data from Flask app
    async function fetchWatchtimeData() {
      try {
        const response = await makeAuthenticatedRequest(`/get-watchtime?uniqueIdentifier=${uniqueIdentifier}`);
        console.log('Fetched watchtime data:', response); // Debugging
        
        const data = await response.json();
        console.log('Parsed watchtime data:', data); // Debugging
        
        if (response.ok && data.status === 'success') {
          return data.data;
        } else {
          console.error('Failed to fetch watchtime data:', data);
          return [];
        }
      } catch (error) {
        console.error('Failed to fetch watchtime data:', error);
        return [];
      }
    }

    // Function to update the popup UI
    async function updatePopupUI() {
      try {
        console.log('Updating popup data...'); // Log to console

        // Fetch watchtime data from Flask app
        const watchtimeData = await fetchWatchtimeData();
        console.log('Received watchtime data:', watchtimeData); // Debugging

        // Initialize chart data for last 7 days
        const dailyWatchtime = Array(7).fill(0);
        const today = new Date();
        
        // Populate daily watchtime from history (keep in milliseconds for now)
        watchtimeData.forEach(entry => {
          const entryDate = new Date(entry.timestamp);
          const dayDiff = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
          if (dayDiff < 7) {
            const dayIndex = (today.getDay() - dayDiff + 7) % 7; // Ensure positive index
            dailyWatchtime[dayIndex] += entry.watchtime; // Add raw milliseconds
          }
        });

        // Calculate total watchtime (convert milliseconds to minutes at the end)
        const totalWatchtimeMs = dailyWatchtime.reduce((total, ms) => total + ms, 0);
        const totalMinutes = Math.round(totalWatchtimeMs / 60000); // Convert total ms to minutes

        // Convert daily watchtime array to minutes for the chart
        const dailyWatchtimeMinutes = dailyWatchtime.map(ms => Math.round(ms / 60000));

        // Update summary
        if (summaryElement) {
          summaryElement.textContent = `Total Watchtime: ${totalMinutes} minutes`;
        }

        // Initialize or update the chart
        if (ctx) {
          if (!chart) {
            chart = new Chart(ctx, {
              type: 'bar',
              data: {
                labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
                datasets: [{
                  label: 'Watchtime (minutes)',
                  data: dailyWatchtimeMinutes,
                  backgroundColor: 'rgba(229, 9, 20, 0.2)',
                  borderColor: 'rgba(229, 9, 20, 1)',
                  borderWidth: 1
                }]
              },
              options: {
                scales: {
                  y: {
                    beginAtZero: true,
                    title: {
                      display: true,
                      text: 'Minutes'
                    }
                  }
                }
              }
            });
          } else {
            chart.data.datasets[0].data = dailyWatchtimeMinutes;
            chart.update();
          }
        }
      } catch (error) {
        console.error('Error updating popup:', error);
        if (summaryElement) {
          summaryElement.textContent = 'Error loading watchtime data';
        }
      }
    }

    // Update the popup UI immediately when opened
    updatePopupUI();

    // Set up a timer to update the popup UI every 5 seconds
    const updateInterval = setInterval(updatePopupUI, 5000);

    // Clean up interval when popup is closed
    window.addEventListener('unload', () => {
      clearInterval(updateInterval);
      console.log('Popup closed. Update interval cleared.'); // Log when popup is closed
    });
    // Button event handlers
    if (settingsButton) {
      settingsButton.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
      });
    } else {
      console.error('Settings button not found');
    }

    if (exportButton) {
      exportButton.addEventListener('click', () => {
        // TODO: Implement data export
        alert('Export feature coming soon!');
      });
    } else {
      console.error('Export button not found');
    }
  });
});