document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup loaded.'); // Debugging

  // Initialize chart
  let chart;
  const ctx = document.getElementById('watchtimeChart')?.getContext('2d');

  // Get elements
  const summaryElement = document.getElementById('watchtimeSummary');
  const settingsButton = document.getElementById('settingsButton');
  const exportButton = document.getElementById('exportButton');

  // Retrieve unique identifier
  chrome.storage.local.get(['uniqueIdentifier'], (result) => {
    const uniqueIdentifier = result.uniqueIdentifier;
    console.log('Retrieved unique identifier:', uniqueIdentifier);

    // Function to fetch watchtime data from Flask app
    async function fetchWatchtimeData() {
      const url = `http://188.245.162.217:2523/get-watchtime?uniqueIdentifier=${uniqueIdentifier}`;
      console.log('Fetching watchtime data from:', url); // Debugging

      try {
        const response = await fetch(url);
        const data = await response.json();

        console.log('Fetched watchtime data:', data); // Debugging

        if (data.status === 'success') {
          return data.data;
        } else {
          console.error('Failed to fetch watchtime data:', data);
          return [];
        }
      } catch (error) {
        console.error('Error fetching watchtime data:', error);
        return [];
      }
    }

    // Function to update the popup UI
    async function updatePopupUI() {
      console.log('Updating popup data...'); // Log to console

      // Fetch watchtime data from Flask app
      const watchtimeData = await fetchWatchtimeData();

      // Calculate total watchtime
      const totalWatchtime = watchtimeData.reduce((total, entry) => total + entry.watchtime, 0);
      const minutes = (totalWatchtime / 60000).toFixed(0); // Convert to minutes

      // Update summary
      if (summaryElement) {
        summaryElement.textContent = `Total Watchtime: ${minutes} minutes`;
      }

      // Initialize chart data
      const dailyWatchtime = [0, 0, 0, 0, 0, 0, 0]; // Initialize for 7 days

      // Populate daily watchtime from history
      watchtimeData.forEach(entry => {
        const day = new Date(entry.timestamp).getDay(); // 0 (Sunday) to 6 (Saturday)
        dailyWatchtime[day] += entry.watchtime / 60000; // Convert to minutes
      });
      
      if (!ctx) {
        console.error('Chart context not found');
        return;
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
                data: dailyWatchtime,
                backgroundColor: 'rgba(229, 9, 20, 0.2)',
                borderColor: 'rgba(229, 9, 20, 1)',
                borderWidth: 1
              }]
            },
            options: {
              scales: {
                y: {
                  beginAtZero: true
                }
              }
            }
          });
        } else {
          // Update existing chart data
          chart.data.datasets[0].data = dailyWatchtime;
          chart.update();
        }
      } else {
        console.error('Chart context not found');
      }

      console.log('Popup data updated:', { minutes, dailyWatchtime }); // Log updated data
    }

    // Update the popup UI immediately when opened
    updatePopupUI();

    // Set up a timer to update the popup UI every 5 seconds
    const updateInterval = setInterval(updatePopupUI, 5000); // 5000ms = 5 seconds

    // Clean up the interval when the popup is closed
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