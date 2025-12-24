use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Project type enum stored as string in database
#[derive(Clone, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[sea_orm(rs_type = "String", db_type = "Text")]
#[serde(rename_all = "lowercase")]
pub enum ProjectType {
    #[sea_orm(string_value = "xcode")]
    Xcode,
    #[sea_orm(string_value = "android")]
    Android,
}

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "projects")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    /// Path to the project file (.xcworkspace, .xcodeproj, or build.gradle)
    #[sea_orm(unique)]
    pub path: String,
    pub name: String,
    pub project_type: ProjectType,
    pub last_opened_at: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
