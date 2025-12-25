use crate::xcode;
use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct XcodeSchemesRequest {
    pub path: String,
}

/// Get Xcode schemes for a project or workspace
pub async fn get_xcode_schemes(Json(request): Json<XcodeSchemesRequest>) -> impl IntoResponse {
    let path = Path::new(&request.path);

    match xcode::discover_project(path).await {
        Ok(project) => (StatusCode::OK, Json(Value::from(serde_json::to_value(project).unwrap()))).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response(),
    }
}
