#!/usr/bin/env python3
"""
HealthSpace API Client for Prince George Restaurant Inspections
Fetches restaurant inspection data from the Northern Health Authority HealthSpace system.
"""

import requests
from bs4 import BeautifulSoup
from datetime import datetime
import json
import time
import re

class HealthSpaceAPI:
    """
    API client for Northern Health Authority HealthSpace food inspection data.
    Supports all cities/regions in Northern Health, not just Prince George.
    """

    # All cities/regions in Northern Health with their category IDs
    CITIES = {
        "Arras": "1EE41E3B326B44ACF6EC9782EF103525",
        "Atlin": "E5A5B1DC964EB21FC3330B6C40E8DE72",
        "Baker Creek": "35050BDFC2BEE89DE6109343E3B559DB",
        "Barkerville": "6E753BBCD0538809EF2610AC2D2C9224",
        "Bear Lake": "4B8E81FC525AD273D9DB1ABE15879F41",
        "Bob Quinn": "BC1159D79636E2BFCA23FF758C34EFEB",
        "Bowron Lake": "93B16DE1F08415B2C96E8BA644E14FA3",
        "Buckinghorse River": "8D68D77F6CDC82767969B0E6322BD67C",
        "Buick Creek": "E0090064099909C3A58DFCF0B591D52F",
        "Burns Lake": "052B210F3F54DEE37ADA85B0A99DBC6C",
        "Cassiar": "A18BA40C72E3DE29CBEFBD31B7BB01AB",
        "Cecil Lake": "845A5B3E53164FFC001F996DFF380A25",
        "Charlie Lake": "8DFBE413E62D8D80497136B6ECC1E23B",
        "Chetwynd": "4B49EBDE9DBD117DFDF3C9F4C36BCAE5",
        "Cluculz Lake": "84A49D0753F49E74CD762D85862F1914",
        "Crescent Spur": "A02C7B77CA21E4AA19E503A1F0AA4283",
        "Daajing Giids (Queen Charlotte)": "C39360E60C6EA108E32E3ABA98ECB059",
        "Dawson Creek": "77F9CBC769816B7BA30FD0DC60E14799",
        "Dease Lake": "72F34813E6A1DEE67D182E47425401EE",
        "Decker Lake": "D0E4B3BC7C206997DF555233944697CF",
        "Doe River": "1103694A7B13D465A74FC7640CF82A1F",
        "Dome Creek": "50C3AA70A1401226C123BA63029FD3DE",
        "Dunster": "F859DDE03D8D0D4FC3E8A756E20AAD71",
        "Farmington": "B08D943FDADF172AC25459FD9A313B98",
        "Fireside": "B6E30AED77097DC09100CB0567E97A89",
        "Fort Fraser": "10351F5B8A5D1D5C79935A3CBD583D94",
        "Fort Nelson": "3A53C416B8E2D677BF409A1192810295",
        "Fort St James": "277590A576DC47699E1C3FCA96F164CF",
        "Fort St. John": "51EC4B5E1482A0AB834770D4ABAE7DB7",
        "Fraser Fort George Regional District": "F9A95271F5214169C5061631418EF15F",
        "Fraser Lake": "AC614497863013008EAF8AABC6B69D66",
        "Goodlow": "B7110FAD2A71E097BD692CBD17266BB4",
        "Granisle": "EF641C9B93225F4BA041D106A5F48CC2",
        "Grassy Plains": "EC89FD021E458D7B50F58D47635D115A",
        "Groundbirch": "45660E562FE43C1CEF0D466EE4A5515F",
        "Hazelton": "D9777AF820B246E6535B6C0352C5EDDD",
        "Hixon": "7D40FB4E95B1E26934D0EF16107F82AF",
        "Houston": "B7D70B861604EDA8FF688824106C7AD5",
        "Hudson's Hope": "1160F78CC264F898F2A2623DB5A7C93F",
        "Iskut": "D0BD1BD19B57D9A7E3B04900F08958D7",
        "Jade City": "B03AACBD41E2133CC17015DADC77F7CC",
        "Kemano": "A53F6429E5F7E0B448BA988672741C44",
        "Kispiox": "6CCF2FB9D148272589138871DC41452C",
        "Kitimat": "A2D1061D362C59181ED57C86EA1420B9",
        "Kitwanga": "D2DD0F600D4059607545E6C30884918E",
        "Liard River": "9BF8F5C4A678EE9B2F48B225EAC4E921",
        "Mackenzie": "5AA4E09B3FCA0D6639D652C4EB0B39DB",
        "Masset": "645581E7D29D09F13A0F8FCD4A32C01F",
        "McBride": "A9CA66F90245849571DD0B37E65A36AF",
        "Meziadin": "C356F5F8438ACD6005CECBEB8C061700",
        "Moberly Lake": "1003709C5AC60FF7EBCF917E547B6389",
        "Mobile Camp": "023ECF8D6F550C07111245E1BE221203",
        "Montney": "371360E864E5D9E1C3D495E107E691C7",
        "Muncho Lake": "40EF7CB064B077E6174D71A9C23406E5",
        "Nass Valley": "01BE71C734F262F3E7E1956600AB07E6",
        "Nazko": "D3A8E0BCB931034384D532564646545C",
        "New Hazelton": "087EC4526843CD6448A8366E4FC34CF7",
        "North Coast Regional District": "8A53E3B6C95AE5876721C94C088F4EA6",
        "Old Masset": "D4A0C61E81020CCE6D4F7BE0EB804618",
        "Ootsa East": "D085432E6B7A58FBD6260E479224868F",
        "Ootsa Lake": "A4C27E249BFE957F4280A4F71E62517F",
        "Peace River Regional District": "D961E9E98E676E43A21C4B30B65B1F5F",
        "Pink Mountain": "9CAFF324FDA9175E712E2D37C9D6493B",
        "Port Clements": "CAE83ADE00F81E4C0B37633EFF76ED88",
        "Port Edward": "1FB8E46FEC60D7A74B5B7C09197FC68D",
        "Pouce Coupe": "6DB35E694FD5809D28CA2A6358D68C08",
        "Prespatou": "68C1582FD15DAB479AB6C01C1314805F",
        "Prince George": "FD4BF9F2DD74F5A2FC5B1DE44C0A8E31",
        "Prince Rupert": "86B0524C683C95BD738C07EE82F29886",
        "Progress": "DA67B2825929BB33673CEDF3BD7B22B2",
        "Quesnel": "0D15D080F4C6CCDAD5460A9D11EC07C6",
        "Regional District - Bulkley Nechako": "04F9478400F6DF73A707074CB9EC779F",
        "Regional District - Kitimat-Stikine": "8898A15E527BE3797F776B85C91A031F",
        "Rolla": "4A8958DE6C627FBE6D2C0AB4B814E348",
        "Rose Prairie": "C9B3B9887C9189E1EA87264E4052C56F",
        "Rosswood": "255B2C393A31C622DCB113B00F284BE2",
        "Sandspit": "EAFC165D24F7AAD784FF1FF04FEAC1A7",
        "Sinclair Mills": "CC40927F364F30161858161666D5D1C0",
        "Smithers": "655552F18E2ACB65A2B4AD7129CDCD7F",
        "South Hazelton": "E5486AA56B7A284B03F1A18826B7E6D7",
        "Stewart": "4F5EA4153DC11AD007522816487FC1E8",
        "Sunset Prairie": "8BA35FC42D0DFF7CC90D9A0503438B2A",
        "Taylor": "2512DF6F7A1CCF7A9CB8A4B9CEB3D107",
        "Telegraph Creek": "C35B3BA225915D9B83042B1E1DF66B44",
        "Telkwa": "CDF58D08ABCDA2FB06AFC56DE331E8A9",
        "Terrace": "2D7CDAEA7A29ACC35EF07CA0D1A9501D",
        "Tete Jaune Cache": "4F935628C4BDBFD5C8301397FDA53E91",
        "Thornhill": "0DE0A9B218E5D9523A8FFD9CA31858B6",
        "Tlell": "B7CEF58697F2C71D03996A110B419375",
        "Toad River": "55D1476FA871ABDC720E8543F7C7E9A8",
        "Tomslake": "E7AF53FAB906B4D9BC68B1EE48992DDD",
        "Topley": "F851D262F42D46153F8AE219EB6A3F0E",
        "Tumbler Ridge": "AA009465240EB123AB65383A6E1E7E57",
        "Tupper": "3F734C8B1D9B527168AE718542C61A17",
        "Valemount": "8E8EA7A78A0DCC0143FF1F08282092FF",
        "Vanderhoof": "14A1284AB7FF9C566D7E2DD72ABEF1CC",
        "Wells": "C7235940DA092C65970494481C0DD2A5",
        "Willow River": "5967AB29B97B332968BCDE5B3967E0C8",
        "Wonowon": "ADC039A24934E12DC0CF625300C9B2A4",
    }

    # Default city
    DEFAULT_CITY = "Prince George"

    def __init__(self, city=None):
        """
        Initialize the HealthSpace API client.

        Args:
            city: City name (default: Prince George). Use get_cities() to see all available cities.
        """
        self.base_url = "https://www.healthspace.ca/Clients/NHA/NHA_Website.nsf"
        self.session = requests.Session()
        self.city = city or self.DEFAULT_CITY
        self.category = self.CITIES.get(self.city)

        if not self.category:
            raise ValueError(f"Unknown city: {city}. Use HealthSpaceAPI.get_cities() to see available cities.")

        # Headers to mimic a browser request (helps avoid bot detection)
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Sec-Fetch-Dest': 'frame',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
        })

    @classmethod
    def get_cities(cls):
        """Get list of all available cities in Northern Health"""
        return sorted(cls.CITIES.keys())

    @classmethod
    def get_city_id(cls, city_name):
        """Get the category ID for a city"""
        return cls.CITIES.get(city_name)

    def get_restaurants(self, start=0, count=30, category=None):
        """
        Fetch restaurant list from HealthSpace API

        Args:
            start: Starting index for pagination
            count: Number of results to return
            category: Category ID (default uses the city set in __init__)

        Returns:
            List of restaurant data dictionaries
        """
        url = f"{self.base_url}/Food-List-ByName"
        params = {
            'OpenView': '',
            'RestrictToCategory': category or self.category,
            'Count': count,  # Capital C
        }

        # Only add start if not the first page
        if start > 0:
            params['start'] = start

        try:
            print(f"Fetching: {url}")
            print(f"Params: start={start}, count={count}")

            response = self.session.get(url, params=params, timeout=30)
            print(f"Status Code: {response.status_code}")

            response.raise_for_status()

            # Parse the HTML response
            soup = BeautifulSoup(response.text, 'html.parser')
            restaurants = self._parse_restaurant_list(soup)

            return restaurants
        except requests.exceptions.RequestException as e:
            print(f"Error fetching data: {e}")
            print(f"Response status: {response.status_code if 'response' in locals() else 'N/A'}")

            # Save response for debugging if we got one
            if 'response' in locals():
                with open('healthspace_debug.html', 'w', encoding='utf-8') as f:
                    f.write(response.text)
                print("Response saved to healthspace_debug.html for inspection")

            return None

    def _parse_restaurant_list(self, soup):
        """Parse the restaurant list from HTML"""
        restaurants = []

        # Save HTML for debugging first time
        with open('healthspace_response.html', 'w', encoding='utf-8') as f:
            f.write(soup.prettify())
        print("HTML saved to healthspace_response.html for inspection\n")

        # Try to find the data table
        # HealthSpace typically uses viewEntryTable class
        table = soup.find('table', class_='viewEntryTable')

        if not table:
            # Try other common table patterns
            table = soup.find('table')

        if not table:
            print("Warning: Could not find data table in response")
            return restaurants

        # Find all rows, skip header
        rows = table.find_all('tr')[1:]  # Skip header row

        print(f"Found {len(rows)} rows in table\n")

        for idx, row in enumerate(rows):
            cells = row.find_all('td')

            if len(cells) < 2:
                continue

            restaurant = {}

            # Extract data from cells
            # Typical structure: Name, Address, Last Inspection, etc.
            for i, cell in enumerate(cells):
                # Get text content
                text = cell.get_text(strip=True)

                # Extract links
                link = cell.find('a')
                if link and 'href' in link.attrs:
                    if i == 0:  # First column usually has the name
                        restaurant['name'] = text
                        restaurant['details_url'] = f"https://www.healthspace.ca{link['href']}"

            # Map columns: Name (0), blank (1), Address (2), Hazard Rating (3)
            if len(cells) >= 1:
                restaurant['name'] = cells[0].get_text(strip=True)
            if len(cells) >= 3:
                restaurant['address'] = cells[2].get_text(strip=True)
            if len(cells) >= 4:
                restaurant['hazard_rating'] = cells[3].get_text(strip=True)

            # Get detail link from first cell
            link = cells[0].find('a') if cells else None
            if link and 'href' in link.attrs:
                href = link['href']
                if not href.startswith('http'):
                    restaurant['details_url'] = f"https://www.healthspace.ca{href}"
                else:
                    restaurant['details_url'] = href

            restaurant['scraped_at'] = datetime.now().isoformat()

            if restaurant.get('name'):
                restaurants.append(restaurant)

        return restaurants

    def search_restaurants(self, query):
        """
        Search for restaurants by name using the HealthSpace search endpoint

        Args:
            query: Search query string

        Returns:
            List of matching restaurants
        """
        url = f"{self.base_url}/Food-List-ByName"

        try:
            print(f"Searching for: {query}")

            # POST request with search parameters
            response = self.session.post(
                url,
                params={'SearchView': ''},
                data={
                    'Query': query,
                    'SearchWV': '1',
                    'SearchFuzzy': '1'
                },
                timeout=30
            )
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')
            restaurants = self._parse_restaurant_list(soup)

            print(f"Found {len(restaurants)} results for '{query}'")
            return restaurants

        except requests.exceptions.RequestException as e:
            print(f"Error searching: {e}")
            return None

    def get_facility_details(self, details_url):
        """
        Fetch detailed facility information including inspection history

        Args:
            details_url: URL to the facility history page

        Returns:
            Dictionary with facility info and inspection history
        """
        try:
            print(f"  Fetching facility details: {details_url[:80]}...")
            response = self.session.get(details_url, timeout=30)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')
            facility = {}

            # Get facility name from h2
            h2 = soup.find('h2')
            if h2:
                facility['name'] = h2.get_text(strip=True)

            # Get facility location
            location_text = soup.get_text()
            if 'Facility Location:' in location_text:
                # Find the paragraph containing facility location
                for p in soup.find_all('p'):
                    if 'Facility Location:' in p.get_text():
                        # Extract address lines
                        text = p.get_text(separator='\n', strip=True)
                        lines = text.split('\n')
                        # Skip "Facility Location:" and get address lines
                        addr_lines = [l.strip() for l in lines[1:] if l.strip()]
                        facility['full_address'] = ', '.join(addr_lines)
                        break

            # Get facility info table (Facility Type, Hazard Rating, Non-Smoking)
            for table in soup.find_all('table'):
                rows = table.find_all('tr')
                for row in rows:
                    cells = row.find_all('td')
                    if len(cells) >= 2:
                        label = cells[0].get_text(strip=True).lower()
                        value = cells[1].get_text(strip=True)

                        if 'facility type' in label:
                            facility['facility_type'] = value
                        elif 'hazard rating' in label:
                            facility['current_hazard_rating'] = value
                        elif 'non-smoking' in label:
                            facility['non_smoking'] = value

            # Get inspection history
            facility['inspections'] = []

            # Find the inspection history table (has thead with "Inspection Type")
            for table in soup.find_all('table'):
                thead = table.find('thead')
                if thead and 'Inspection Type' in thead.get_text():
                    tbody = table.find('tbody')
                    if tbody:
                        rows = tbody.find_all('tr')
                        for row in rows:
                            cells = row.find_all('td')
                            if len(cells) >= 3:
                                inspection = {}

                                # First cell: Inspection Type with link
                                link = cells[0].find('a')
                                if link:
                                    inspection['type'] = link.get_text(strip=True)
                                    href = link.get('href', '')
                                    if not href.startswith('http'):
                                        inspection['details_url'] = f"https://www.healthspace.ca{href}"
                                    else:
                                        inspection['details_url'] = href

                                # Second cell: Date
                                if len(cells) >= 2:
                                    inspection['date'] = cells[1].get_text(strip=True)

                                # Third cell: Hazard rating
                                if len(cells) >= 3:
                                    rating_text = cells[2].get_text(strip=True)
                                    inspection['hazard_rating'] = rating_text

                                if inspection.get('type'):
                                    facility['inspections'].append(inspection)
                    break

            return facility

        except requests.exceptions.RequestException as e:
            print(f"  Error fetching facility details: {e}")
            return None

    def get_inspection_details(self, inspection_url):
        """
        Fetch detailed inspection report including violations

        Args:
            inspection_url: URL to the inspection details page

        Returns:
            Dictionary with inspection info and violations
        """
        try:
            print(f"    Fetching inspection: {inspection_url[:80]}...")
            response = self.session.get(inspection_url, timeout=30)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')
            inspection = {}

            # Get inspection title from h2
            h2 = soup.find('h2')
            if h2:
                inspection['title'] = h2.get_text(strip=True)

            # Get inspection info table
            for table in soup.find_all('table'):
                rows = table.find_all('tr')
                for row in rows:
                    cells = row.find_all('td')
                    if len(cells) >= 2:
                        label = cells[0].get_text(strip=True).lower()
                        value = cells[1].get_text(strip=True)

                        if 'facility type' in label:
                            inspection['facility_type'] = value
                        elif 'inspection type' in label:
                            inspection['inspection_type'] = value
                        elif 'inspection date' in label:
                            inspection['inspection_date'] = value
                        elif 'critical violations' in label:
                            try:
                                inspection['critical_violations_count'] = int(value)
                            except ValueError:
                                inspection['critical_violations_count'] = value
                        elif 'non-critical violations' in label:
                            try:
                                inspection['non_critical_violations_count'] = int(value)
                            except ValueError:
                                inspection['non_critical_violations_count'] = value
                        elif 'follow-up' in label:
                            inspection['follow_up_required'] = value

            # Get hazard rating from paragraph
            for p in soup.find_all('p'):
                text = p.get_text()
                if 'hazard rating' in text.lower():
                    # Extract the rating (low, moderate, high)
                    match = re.search(r'(low|moderate|high)', text.lower())
                    if match:
                        inspection['hazard_rating'] = match.group(1).capitalize()
                    break

            # Get violations
            inspection['violations'] = []

            # Find violations table (has thead with "Code" and "Description")
            for table in soup.find_all('table'):
                thead = table.find('thead')
                if thead and 'Code' in thead.get_text() and 'Description' in thead.get_text():
                    tbody = table.find('tbody')
                    if tbody:
                        rows = tbody.find_all('tr')
                        for row in rows:
                            cells = row.find_all('td')
                            if len(cells) >= 2:
                                violation = {}

                                # First cell: Code
                                code_text = cells[0].get_text(strip=True)
                                if code_text:
                                    violation['code'] = code_text

                                # Second cell: Full description
                                desc_cell = cells[1]
                                full_text = desc_cell.get_text(separator='\n', strip=True)

                                # Parse the description structure
                                # Main description is before "Observation:"
                                # Observation is in blue text
                                # Corrective Action is in green text

                                # Check if corrected during inspection
                                if '(CORRECTED DURING INSPECTION)' in full_text:
                                    violation['corrected_during_inspection'] = True
                                else:
                                    violation['corrected_during_inspection'] = False

                                # Extract main description (first line before Observation)
                                lines = full_text.split('\n')
                                if lines:
                                    # First line is usually the violation description
                                    violation['description'] = lines[0].strip()

                                # Extract observation
                                obs_match = re.search(r'Observation:\s*(.*?)(?=Corrective Action:|$)', full_text, re.DOTALL | re.IGNORECASE)
                                if obs_match:
                                    obs_text = obs_match.group(1).strip()
                                    # Clean up the observation text
                                    obs_text = re.sub(r'\(CORRECTED DURING INSPECTION\)', '', obs_text).strip()
                                    violation['observation'] = obs_text

                                # Extract corrective action
                                ca_match = re.search(r'Corrective Action:\s*(.*?)$', full_text, re.DOTALL | re.IGNORECASE)
                                if ca_match:
                                    violation['corrective_action'] = ca_match.group(1).strip()

                                if violation.get('code'):
                                    inspection['violations'].append(violation)
                    break

            return inspection

        except requests.exceptions.RequestException as e:
            print(f"    Error fetching inspection details: {e}")
            return None

    def get_restaurant_full_details(self, restaurant, fetch_inspections=True, max_inspections=None):
        """
        Fetch complete details for a restaurant including all inspections and violations

        Args:
            restaurant: Restaurant dict with details_url
            fetch_inspections: Whether to fetch individual inspection details
            max_inspections: Maximum number of inspections to fetch (None for all)

        Returns:
            Restaurant dict with full inspection and violation data
        """
        if not restaurant.get('details_url'):
            return restaurant

        # Get facility details with inspection history
        facility = self.get_facility_details(restaurant['details_url'])

        if facility:
            # Merge facility info into restaurant
            restaurant['facility_type'] = facility.get('facility_type')
            restaurant['full_address'] = facility.get('full_address')
            restaurant['current_hazard_rating'] = facility.get('current_hazard_rating')
            restaurant['non_smoking'] = facility.get('non_smoking')
            restaurant['inspections'] = facility.get('inspections', [])

            # Fetch individual inspection details if requested
            if fetch_inspections and restaurant['inspections']:
                inspections_to_fetch = restaurant['inspections']
                if max_inspections:
                    inspections_to_fetch = inspections_to_fetch[:max_inspections]

                for i, insp in enumerate(inspections_to_fetch):
                    if insp.get('details_url'):
                        time.sleep(1)  # Be respectful
                        details = self.get_inspection_details(insp['details_url'])
                        if details:
                            # Merge inspection details
                            insp['inspection_date'] = details.get('inspection_date')
                            insp['inspection_type'] = details.get('inspection_type')
                            insp['critical_violations_count'] = details.get('critical_violations_count', 0)
                            insp['non_critical_violations_count'] = details.get('non_critical_violations_count', 0)
                            insp['follow_up_required'] = details.get('follow_up_required')
                            insp['violations'] = details.get('violations', [])

            restaurant['details_fetched_at'] = datetime.now().isoformat()

        return restaurant

    def get_all_restaurants_with_details(self, max_restaurants=None, max_inspections_per_restaurant=None,
                                         fetch_inspection_details=True):
        """
        Fetch all restaurants with complete inspection history and violations

        Args:
            max_restaurants: Maximum number of restaurants to fetch details for (None for all)
            max_inspections_per_restaurant: Max inspections to fetch per restaurant (None for all)
            fetch_inspection_details: Whether to fetch full inspection details including violations

        Returns:
            List of restaurants with full details
        """
        print("=" * 60)
        print(f"Fetching All {self.city} Restaurants with Full Inspection Details")
        print("=" * 60 + "\n")

        # First get the basic restaurant list
        all_restaurants = self.get_all_restaurants()

        if not all_restaurants:
            print("Failed to fetch restaurant list")
            return None

        restaurants_to_process = all_restaurants
        if max_restaurants:
            restaurants_to_process = all_restaurants[:max_restaurants]

        print(f"\nFetching details for {len(restaurants_to_process)} restaurants...\n")

        for i, restaurant in enumerate(restaurants_to_process):
            print(f"\n[{i+1}/{len(restaurants_to_process)}] {restaurant.get('name', 'Unknown')}")

            self.get_restaurant_full_details(
                restaurant,
                fetch_inspections=fetch_inspection_details,
                max_inspections=max_inspections_per_restaurant
            )

            # Be respectful to the server
            time.sleep(2)

        print(f"\n{'=' * 60}")
        print(f"Completed fetching details for {len(restaurants_to_process)} restaurants")
        print(f"{'=' * 60}\n")

        return all_restaurants

    def get_all_restaurants(self, max_pages=None):
        """
        Fetch all restaurants by paginating through results

        Args:
            max_pages: Maximum number of pages to fetch (None for all)

        Returns:
            List of all restaurant data
        """
        all_restaurants = []
        start = 0
        count = 30
        page = 0

        print("=" * 60)
        print(f"Fetching All {self.city} Restaurants")
        print("=" * 60 + "\n")

        while True:
            if max_pages and page >= max_pages:
                print(f"Reached max_pages limit ({max_pages})")
                break

            print(f"\n--- Page {page + 1} ---")
            restaurants = self.get_restaurants(start=start, count=count)

            if restaurants is None:
                print("Error occurred, stopping pagination")
                break

            if not restaurants:
                print("No more data, stopping pagination")
                break

            print(f"Found {len(restaurants)} restaurants on this page")
            all_restaurants.extend(restaurants)

            # If we got fewer results than requested, we've reached the end
            if len(restaurants) < count:
                print("Got fewer results than requested - reached end")
                break

            start += count
            page += 1

            # Be respectful to the server
            time.sleep(2)

        print(f"\n{'=' * 60}")
        print(f"Total restaurants fetched: {len(all_restaurants)}")
        print(f"{'=' * 60}\n")

        return all_restaurants

    def save_to_json(self, data, filename=None):
        """Save restaurant data to JSON file"""
        if filename is None:
            # Generate filename from city name
            safe_city = self.city.lower().replace(' ', '_').replace('.', '')
            filename = f'{safe_city}_restaurants.json'

        # Add city info to each restaurant
        for restaurant in data:
            restaurant['city'] = self.city

        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"Saved {len(data)} restaurants to {filename}")
        return filename


def fetch_all_cities(output_dir='.', with_details=False, max_inspections=None):
    """
    Fetch restaurant data for ALL cities in Northern Health

    Args:
        output_dir: Directory to save JSON files
        with_details: Whether to fetch full inspection details
        max_inspections: Max inspections per restaurant (if with_details=True)

    Returns:
        Dict mapping city names to their data files
    """
    import os

    cities = HealthSpaceAPI.get_cities()
    results = {}

    print("=" * 60)
    print(f"Fetching data for {len(cities)} cities in Northern Health")
    print("=" * 60 + "\n")

    for i, city in enumerate(cities):
        print(f"\n[{i+1}/{len(cities)}] Processing {city}...")

        try:
            api = HealthSpaceAPI(city=city)

            if with_details:
                data = api.get_all_restaurants_with_details(
                    max_inspections_per_restaurant=max_inspections
                )
            else:
                data = api.get_all_restaurants()

            if data:
                filename = api.save_to_json(data)
                results[city] = {
                    'file': filename,
                    'count': len(data)
                }
            else:
                results[city] = {'file': None, 'count': 0}

            # Be respectful between cities
            time.sleep(3)

        except Exception as e:
            print(f"  Error processing {city}: {e}")
            results[city] = {'file': None, 'error': str(e)}

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    total = sum(r.get('count', 0) for r in results.values())
    print(f"Total restaurants across all cities: {total}")
    print("=" * 60)

    return results


def main():
    """Main function to fetch and display restaurant data"""
    import sys

    # Parse command line arguments
    city = "Prince George"  # Default
    with_details = False
    all_cities = False

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--city' and i + 1 < len(args):
            city = args[i + 1]
            i += 2
        elif args[i] == '--list-cities':
            print("Available cities in Northern Health:")
            print("-" * 40)
            for c in HealthSpaceAPI.get_cities():
                print(f"  {c}")
            print(f"\nTotal: {len(HealthSpaceAPI.get_cities())} cities")
            return
        elif args[i] == '--all-cities':
            all_cities = True
            i += 1
        elif args[i] == '--with-details':
            with_details = True
            i += 1
        elif args[i] in ['--help', '-h']:
            print("Northern Health Restaurant Inspection Scraper")
            print("-" * 50)
            print("Usage: python healthspace_pg_restaurants.py [options]")
            print("")
            print("Options:")
            print("  --city <name>     Fetch data for a specific city (default: Prince George)")
            print("  --list-cities     List all available cities")
            print("  --all-cities      Fetch data for ALL cities")
            print("  --with-details    Fetch full inspection details and violations")
            print("  --help, -h        Show this help message")
            print("")
            print("Examples:")
            print("  python healthspace_pg_restaurants.py --city Terrace")
            print("  python healthspace_pg_restaurants.py --city 'Fort St. John' --with-details")
            print("  python healthspace_pg_restaurants.py --all-cities")
            return
        else:
            i += 1

    if all_cities:
        fetch_all_cities(with_details=with_details)
        return

    try:
        api = HealthSpaceAPI(city=city)
    except ValueError as e:
        print(f"Error: {e}")
        print("\nUse --list-cities to see available cities")
        return

    print("=" * 60)
    print(f"{city} Restaurant Inspections")
    print("Northern Health HealthSpace Scraper")
    print("=" * 60 + "\n")

    # Fetch restaurants
    if with_details:
        all_restaurants = api.get_all_restaurants_with_details()
    else:
        all_restaurants = api.get_all_restaurants()

    if all_restaurants:
        print("\n" + "=" * 60)
        print("RESTAURANT SUMMARY")
        print("=" * 60 + "\n")

        # Display first 10 restaurants
        for i, restaurant in enumerate(all_restaurants[:10], 1):
            print(f"{i}. {restaurant.get('name', 'N/A')}")
            print(f"   Address: {restaurant.get('address', 'N/A')}")
            print(f"   Hazard: {restaurant.get('hazard_rating', 'N/A')}")
            if with_details and restaurant.get('inspections'):
                print(f"   Inspections: {len(restaurant.get('inspections', []))}")
            print()

        if len(all_restaurants) > 10:
            print(f"... and {len(all_restaurants) - 10} more restaurants\n")

        # Save to JSON
        filename = api.save_to_json(all_restaurants)

        print(f"\n{'=' * 60}")
        print(f"Data saved to {filename}")
        print(f"{'=' * 60}")
    else:
        print("\nFailed to fetch data.")
        print("\nPossible issues:")
        print("1. Site requires cookies/session from browser visit")
        print("2. WAF protection blocking automated requests")
        print("3. Need to solve CAPTCHA first")
        print("\nCheck healthspace_response.html for the actual HTML structure")


if __name__ == "__main__":
    main()
