# Smart AI Face Attendance System

An AI-powered, multi-company face attendance management system built
using **Django, Django REST Framework, React.js, and Three.js**.

The platform allows multiple companies to use a centralized attendance
application. A platform administrator registers and authorizes each
company, assigns its access domain, and controls whether that company
can use the system.

------------------------------------------------------------------------

## Table of Contents

-   [Overview](#overview)
-   [How It Works](#how-it-works)
-   [Features](#features)
-   [Technology Stack](#technology-stack)
-   [Project Structure](#project-structure)
-   [System Requirements](#system-requirements)
-   [Installation](#installation)
    -   [Docker Setup](#docker-setup-recommended)
    -   [Manual Setup](#manual-setup)
-   [Environment Configuration](#environment-configuration)
-   [Database Setup](#database-setup)
-   [Accessing the Application](#accessing-the-application)
-   [Multi-Company Architecture](#multi-company-architecture)
-   [Core Database Models](#core-database-models)
-   [Security Considerations](#security-considerations)
-   [Troubleshooting](#troubleshooting)
-   [Contributing](#contributing)
-   [Author](#author)
-   [License](#license)

------------------------------------------------------------------------

## Overview

Smart AI Face Attendance System automates employee attendance using
facial recognition.

Instead of deploying separate attendance software for every
organization, multiple companies can use the same centralized
application. Each company is registered by the platform administrator
and receives an authorized access link.

When a user visits a company's configured domain, the backend identifies
the company and checks whether it is active and authorized. Employee
records and attendance operations must then be scoped to that company.

**Main objective:** Provide a centralized, AI-powered attendance
platform that can serve multiple organizations through company-specific
access links.

## How It Works

1.  **Company registration:** A platform administrator registers a
    company and its domain.
2.  **Company authorization:** The administrator activates or
    deactivates the company's access.
3.  **Company access:** The company uses its authorized link to open the
    attendance application.
4.  **Employee enrollment:** Employees are registered with a
    company-specific employee ID and their face data.
5.  **Face recognition:** The face recognition workflow compares a
    detected face with enrolled face data.
6.  **Attendance:** When an employee is successfully identified and
    passes the application's validation rules, the system records the
    attendance event.

### Workflow

``` text
Platform Administrator
        |
        v
Register Company
        |
        v
Assign Authorized Domain
        |
        v
Activate Company
        |
        v
Company Access Link
        |
        v
Employee Enrollment
        |
        v
Face Recognition
        |
        v
Employee Identification
        |
        v
Attendance Recording
```

## Features

### Multi-company management

-   Multiple companies use one centralized application.
-   Each company has a configured, unique domain.
-   The platform administrator can activate or deactivate company
    access.
-   Employee records are associated with their company.
-   Employee identifiers are unique within each company.

### Face attendance

-   Employee enrollment and face data storage.
-   Face embedding storage.
-   Face-based employee identification.
-   Attendance workflow integrated with the backend.

### Authentication and APIs

-   Company administrator accounts.
-   Password hashing using Django's password hashing utilities.
-   Django REST Framework APIs.
-   Company-level authorization and access validation.

### Frontend

-   React-based user interface.
-   Three.js integration for frontend visualization.
-   Browser-based access to the application.

> Exact recognition capabilities depend on the face-recognition
> libraries and implementation included in the current source code.

## Technology Stack

  Technology                        Purpose
  --------------------------------- --------------------------------------
  Python                            Backend programming
  Django                            Backend framework and ORM
  Django REST Framework             REST API development
  PostgreSQL or SQLite              Database, depending on configuration
  React.js                          Frontend
  Three.js                          3D graphics and visualization
  JavaScript                        Frontend programming
  Docker                            Application containerization
  Docker Compose                    Local container orchestration
  Face-recognition / ML libraries   Face processing and embeddings

## Project Structure

The repository currently contains the main `backend`, `frontend`, and
`source` directories, along with Docker configuration files. The exact
internal files may vary by version.

``` text
Smart-AI-Face-Attendance-System/
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   └── ...
├── frontend/
│   ├── package.json
│   ├── package-lock.json
│   ├── src/
│   └── ...
├── source/
│   └── ...
├── docker/
│   └── dev-entrypoint.sh
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .gitignore
└── README.md
```

## System Requirements

### For Docker setup

-   Docker Desktop on Windows/macOS, or Docker Engine on Linux.
-   Docker Compose.
-   A webcam for testing camera-based attendance.

### For manual setup

-   Python version compatible with `backend/requirements.txt`.
-   Node.js version compatible with the frontend project.
-   npm.
-   Git.
-   A supported database.
-   A webcam for camera-based attendance.

Check installed tools:

``` bash
python --version
node --version
npm --version
docker --version
docker compose version
```

## Installation

Clone the repository:

``` bash
git clone https://github.com/SheikhAz/Smart-AI-Face-Attendance-System.git
cd Smart-AI-Face-Attendance-System
```

### Docker Setup (Recommended)

Docker builds the application environment and runs the Django backend
and React development server.

#### 1. Configure environment variables

Create `backend/.env`. At minimum, configure the variables required by
your Django settings. For example:

``` env
SECRET_KEY=replace-with-a-secure-secret-key
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
```

Your actual project may require additional database, CORS, API, or
service variables. Check `backend` settings and provide all required
values.

#### 2. Build and start

From the repository root:

``` bash
docker compose up --build
```

For detached mode:

``` bash
docker compose up --build -d
```

#### 3. View logs and status

``` bash
docker compose ps
docker compose logs -f app
```

#### 4. Stop the application

``` bash
docker compose down
```

Other useful commands:

``` bash
# Open a shell in the application container
docker compose exec app sh

# Run Django migrations (adjust the path if your container uses another working directory)
docker compose exec app python manage.py migrate
```

If `manage.py` is inside `/smart-face-attendance/backend` and the
container's working directory is the project root, use:

``` bash
docker compose exec app sh -c "cd /smart-face-attendance/backend && python manage.py migrate"
```

### Manual Setup

Run the backend and frontend in separate terminals.

#### 1. Backend environment

``` bash
cd backend
python -m venv venv
```

Activate the virtual environment.

**Windows PowerShell:**

``` powershell
.\venv\Scripts\Activate.ps1
```

**Linux/macOS:**

``` bash
source venv/bin/activate
```

Install Python dependencies:

``` bash
pip install -r requirements.txt
```

Create `backend/.env` and configure the variables required by your
Django settings.

#### 2. Database migrations

From the `backend` directory:

``` bash
python manage.py migrate
```

If the project has model changes that do not yet have migration files,
create them:

``` bash
python manage.py makemigrations
python manage.py migrate
```

Create a Django superuser if the project uses Django's built-in admin:

``` bash
python manage.py createsuperuser
```

#### 3. Start Django

``` bash
python manage.py runserver
```

The backend development server normally runs at:

``` text
http://127.0.0.1:8000/
```

#### 4. Install and start the frontend

Open a second terminal:

``` bash
cd frontend
npm install
npm run dev
```

The Vite development server normally runs at:

``` text
http://localhost:5173/
```

If the frontend uses a configured API base URL, set it to the local
Django API address using the environment-variable name expected by the
frontend code.

## Environment Configuration

Do not copy real credentials into the repository. Create a local
`backend/.env` file and configure the variables actually read by the
Django settings.

Example starting point:

``` env
SECRET_KEY=replace-with-a-secure-secret-key
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
```

Depending on the project's configuration, additional variables may be
needed for: - Database connection details. - CORS and CSRF trusted
origins. - External image or file storage. - Face-processing services or
model paths. - Other third-party services.

Create a sanitized `backend/.env.example` listing required variable
names and safe placeholder values. Do not put real secrets in it.

## Database Setup

Django ORM manages database operations. The database engine is
determined by the `DATABASES` setting in the Django settings module.

SQLite may be suitable for local experimentation if configured.
PostgreSQL is generally a better choice for a production multi-company
deployment.

Apply migrations:

``` bash
python manage.py migrate
```

Back up the database and protect biometric records. Do not expose face
embeddings or private face-image URLs through public endpoints.

## Accessing the Application

With the default development ports:

  Component        Local URL
  ---------------- ------------------------------
  React frontend   http://localhost:5173/
  Django backend   http://localhost:8000/
  Django admin     http://localhost:8000/admin/

The Django root URL may return `404` if no route is configured there.
This does not necessarily mean the backend is unavailable; test a
configured API endpoint or the admin page.

## Multi-Company Architecture

The platform administrator controls which organizations may use the
attendance system.

Example:

  Company            Example domain       Status
  ------------------ -------------------- ----------
  ABC Technologies   `abc.example.com`    Active
  XYZ Solutions      `xyz.example.com`    Active
  Demo Company       `demo.example.com`   Inactive

The backend resolves the requested hostname to a company and checks its
active status. The application should deny access to unknown or inactive
companies.

For a real deployment, a company domain must also be configured with: -
DNS records pointing to the application. - Reverse-proxy or hosting
configuration. - HTTPS/TLS certificates. - Django `ALLOWED_HOSTS` and
relevant CSRF settings. - Backend company-resolution and authorization
logic.

**Important:** Saving a domain in the database does not automatically
create DNS records or configure a working website. Also, resolving a
company from a hostname is not sufficient by itself to secure tenant
data. Every company-specific API operation must enforce server-side
company scoping and authorization.

## Core Database Models

The core models provided for this project are `Company`, `CompanyAdmin`,
and `Staff`.

### Company

Stores organization details.

  Field          Description
  -------------- -----------------------------------
  `id`           UUID primary key
  `name`         Company name
  `domain`       Unique company hostname
  `is_active`    Whether company access is enabled
  `created_at`   Creation timestamp

The model normalizes the domain to a hostname before saving.

### CompanyAdmin

Stores company administrator account details.

  Field          Description
  -------------- ---------------------------------------------------
  `company`      Related company
  `email`        Administrator email
  `password`     Hashed password when set through `set_password()`
  `is_active`    Account status
  `last_login`   Last login timestamp

The model provides `set_password()` and `check_password()` methods.
Application code must call `set_password()` when creating or changing a
password; assigning a raw password directly to the field would not hash
it.

### Staff

Stores employee details and face-related data.

  Field              Description
  ------------------ ----------------------------------------------
  `company`          Related company
  `unique_id`        Employee identifier, unique within a company
  `name`             Employee name
  `embeddings`       JSON list of face embedding vectors
  `face_image_url`   Face image URL
  `is_active`        Employee status
  `created_at`       Creation timestamp

The combination of `company` and `unique_id` is unique. This allows two
different companies to use the same employee ID without conflict.

## Security Considerations

This application handles employee information and potentially biometric
data. Before production use:

-   Use HTTPS.
-   Set `DEBUG=False`.
-   Use a strong, private Django `SECRET_KEY`.
-   Configure `ALLOWED_HOSTS`, CORS, and CSRF settings carefully.
-   Enforce authentication and authorization on sensitive endpoints.
-   Scope every employee and attendance query to the authorized company.
-   Never trust a company identifier supplied only by the browser.
-   Restrict access to face images and embeddings.
-   Use secure database backups and access controls.
-   Obtain appropriate consent and follow applicable privacy and
    data-protection requirements.
-   Define retention and deletion procedures for biometric information.

## Troubleshooting

### Docker is not recognized

Start Docker Desktop or the Docker Engine and check:

``` bash
docker --version
docker compose version
```

### Port is already in use

If ports `8000` or `5173` are occupied, stop the conflicting process or
change the host-side port in `docker-compose.yml`.

### Django migration errors

From the backend directory:

``` bash
python manage.py migrate
```

If migration files need to be generated:

``` bash
python manage.py makemigrations
python manage.py migrate
```

### Frontend cannot connect to backend

Check that: - Django is running. - The frontend API base URL points to
the correct backend address. - CORS and CSRF settings allow the
development frontend origin. - Browser developer tools show no failed
network requests.

### Camera is unavailable

-   Grant camera permission in the browser.
-   Check that another application is not using the webcam.
-   Use a supported browser.
-   Camera access generally requires HTTPS on deployed websites;
    `localhost` is treated as a secure development context by modern
    browsers.

## Contributing

Contributions, suggestions, and bug reports are welcome.

1.  Fork the repository.
2.  Create a feature branch.
3.  Make your changes.
4.  Test your changes locally.
5.  Submit a pull request describing the changes.

## Author

**Sheikh Azmatulla**

-   GitHub: [@SheikhAz](https://github.com/SheikhAz)
-   Repository: [Smart AI Face Attendance
    System](https://github.com/SheikhAz/Smart-AI-Face-Attendance-System)

## License

Add a license file before inviting others to reuse, modify, or
redistribute this project. Without an explicit license, public
availability on GitHub does not automatically grant permission to reuse
the source code.
