import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';

interface Crew {
  id: string;
  crew_name: string;
}

interface CustomProject {
  id: string;
  crew_id: string;
  project_name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface ProjectFormData {
  crew_id: string;
  project_name: string;
  start_date: string;
  end_date: string;
  notes?: string;
}

export default function CustomProjectsManagement() {
  const { token } = useAuthStore();
  const [projects, setProjects] = useState<CustomProject[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedCrewId, setSelectedCrewId] = useState<string>('');
  const [formData, setFormData] = useState<ProjectFormData>({
    crew_id: '',
    project_name: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    notes: '',
  });

  useEffect(() => {
    loadCrews();
    loadProjects();
  }, []);

  const loadCrews = async () => {
    try {
      const res = await fetch('http://localhost:5001/api/crews?active=true', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setCrews(data.data || []);
        if (data.data && data.data.length > 0) {
          setFormData((prev) => ({
            ...prev,
            crew_id: data.data[0].id,
          }));
          setSelectedCrewId(data.data[0].id);
        }
      }
    } catch (error) {
      console.error('Error loading crews:', error);
    }
  };

  const loadProjects = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:5001/api/custom-projects?active=true', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setProjects(data.data || []);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProject = async () => {
    // Validate dates
    if (new Date(formData.start_date) >= new Date(formData.end_date)) {
      alert('Start date must be before end date');
      return;
    }

    try {
      const url = editingId
        ? `http://localhost:5001/api/custom-projects/${editingId}`
        : 'http://localhost:5001/api/custom-projects';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setShowForm(false);
        setEditingId(null);
        setFormData({
          crew_id: selectedCrewId,
          project_name: '',
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0],
          notes: '',
        });
        loadProjects();
      } else {
        const error = await res.json();
        alert(`Error: ${error.message}`);
      }
    } catch (error) {
      console.error('Error saving project:', error);
      alert('Failed to save project');
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
      const res = await fetch(`http://localhost:5001/api/custom-projects/${projectId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (res.ok) {
        loadProjects();
      }
    } catch (error) {
      console.error('Error deleting project:', error);
    }
  };

  const handleEditProject = (project: CustomProject) => {
    setFormData({
      crew_id: project.crew_id,
      project_name: project.project_name,
      start_date: project.start_date,
      end_date: project.end_date,
      notes: project.notes,
    });
    setSelectedCrewId(project.crew_id);
    setEditingId(project.id);
    setShowForm(true);
  };

  const getCrewName = (crewId: string) => {
    return crews.find((c) => c.id === crewId)?.crew_name || 'Unknown';
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-8">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Custom Projects (Crew Blocks)</h2>
        <button
          onClick={() => {
            setShowForm(!showForm);
            if (!showForm) {
              setEditingId(null);
              setFormData({
                crew_id: selectedCrewId,
                project_name: '',
                start_date: new Date().toISOString().split('T')[0],
                end_date: new Date().toISOString().split('T')[0],
                notes: '',
              });
            }
          }}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          {showForm ? 'Cancel' : 'Add Project'}
        </button>
      </div>

      {crews.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-6">
          <p className="text-sm text-yellow-800">
            ℹ️ Create a crew first before adding custom projects.
          </p>
        </div>
      )}

      {showForm && crews.length > 0 && (
        <div className="bg-gray-50 p-4 rounded mb-6 border border-gray-200">
          <h3 className="text-lg font-bold mb-4 text-gray-900">
            {editingId ? 'Edit Project' : 'New Project'}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Crew *</label>
              <select
                value={formData.crew_id}
                onChange={(e) => {
                  setFormData({ ...formData, crew_id: e.target.value });
                  setSelectedCrewId(e.target.value);
                }}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">Select a crew...</option>
                {crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.crew_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Project Name *</label>
              <input
                type="text"
                value={formData.project_name}
                onChange={(e) => setFormData({ ...formData, project_name: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="e.g., Annual Maintenance"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Start Date *</label>
              <input
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">End Date *</label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Notes</label>
              <textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                rows={3}
                placeholder="Additional details about this project..."
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSaveProject}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              {editingId ? 'Update' : 'Create'} Project
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-gray-600">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-8 text-gray-600">No custom projects yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">
                  Project Name
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Crew</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">
                  Start Date
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">End Date</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Duration</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Notes</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const startDate = new Date(project.start_date);
                const endDate = new Date(project.end_date);
                const durationDays = Math.floor(
                  (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
                );

                return (
                  <tr key={project.id} className="border-t hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {project.project_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {getCrewName(project.crew_id)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">{project.start_date}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{project.end_date}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{durationDays} days</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{project.notes || '—'}</td>
                    <td className="px-6 py-4 text-sm space-x-2">
                      <button
                        onClick={() => handleEditProject(project)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteProject(project.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
