use crate::xcode;
use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct XcodeSchemesRequest {
    pub path: String,
}

/// Get Xcode schemes for a project or workspace
pub async fn get_xcode_schemes(Json(request): Json<XcodeSchemesRequest>) -> impl IntoResponse {
    let path = Path::new(&request.path);

    match xcode::discover_project(path) {
        Ok(project) => (
            StatusCode::OK,
            Json(json!({
                "path": project.path,
                "project_type": match project.project_type {
                    xcode::ProjectType::Project => "project",
                    xcode::ProjectType::Workspace => "workspace",
                },
                "schemes": project.schemes,
                "targets": project.targets,
                "configurations": project.configurations,
            })),
        ),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))),
    }
}
