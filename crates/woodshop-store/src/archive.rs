//! `.woodshop` files: one project — draft, version history, notes and thumbnail — as a zip, so a
//! design can be backed up, emailed, or moved to another machine.
//!
//! Layout: `manifest.json` (format, name), `draft.json`, `versions.json`, `notes.json`,
//! `thumbnail.png` (optional). Specs inside are migrated and validated on import like any other.

use std::io::{Read, Seek, Write};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use woodshop_core::spec::{self, Spec};
use zip::write::SimpleFileOptions;

use crate::Author;

pub const FORMAT: &str = "woodshop-project";
pub const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum ArchiveError {
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("Not a Woodshop project file: {0}")]
    Invalid(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectArchive {
    pub name: String,
    pub draft: Spec,
    /// Newest first, as the history lists them.
    pub versions: Vec<ArchivedVersion>,
    pub notes: Vec<ArchivedNote>,
    pub thumbnail: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedVersion {
    pub label: Option<String>,
    pub created_by: Author,
    pub created_at: i64,
    pub spec: Spec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedNote {
    pub body: String,
    pub pinned: bool,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    format: String,
    version: u32,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawVersion {
    label: Option<String>,
    created_by: Author,
    created_at: i64,
    spec: Value,
}

impl ProjectArchive {
    pub fn write<W: Write + Seek>(&self, out: W) -> Result<(), ArchiveError> {
        let mut zip = zip::ZipWriter::new(out);
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let json = |v: Value| serde_json::to_vec_pretty(&v).expect("values serialize");

        zip.start_file("manifest.json", opts)?;
        zip.write_all(&json(
            serde_json::to_value(Manifest {
                format: FORMAT.into(),
                version: FORMAT_VERSION,
                name: self.name.clone(),
            })
            .expect("manifest serializes"),
        ))?;

        zip.start_file("draft.json", opts)?;
        zip.write_all(&json(spec::to_value(&self.draft)))?;

        zip.start_file("versions.json", opts)?;
        zip.write_all(&json(spec::to_value(&self.versions)))?;

        zip.start_file("notes.json", opts)?;
        zip.write_all(&json(serde_json::to_value(&self.notes).expect("notes serialize")))?;

        if let Some(png) = &self.thumbnail {
            zip.start_file(
                "thumbnail.png",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )?;
            zip.write_all(png)?;
        }
        zip.finish()?;
        Ok(())
    }

    pub fn read<R: Read + Seek>(input: R) -> Result<Self, ArchiveError> {
        let mut zip = zip::ZipArchive::new(input)?;
        let mut text = |name: &str| -> Result<Option<String>, ArchiveError> {
            match zip.by_name(name) {
                Ok(mut f) => {
                    let mut s = String::new();
                    f.read_to_string(&mut s)?;
                    Ok(Some(s))
                }
                Err(zip::result::ZipError::FileNotFound) => Ok(None),
                Err(e) => Err(e.into()),
            }
        };
        let invalid = |m: String| ArchiveError::Invalid(m);

        let manifest: Manifest =
            serde_json::from_str(&text("manifest.json")?.ok_or_else(|| invalid("missing manifest.json".into()))?)
                .map_err(|e| invalid(format!("manifest.json: {e}")))?;
        if manifest.format != FORMAT {
            return Err(invalid(format!("unexpected format \"{}\"", manifest.format)));
        }
        if manifest.version > FORMAT_VERSION {
            return Err(invalid(format!(
                "file format {} is newer than this app supports; update Woodshop",
                manifest.version
            )));
        }

        let parse_spec = |label: &str, raw: Value| spec::parse(raw).map_err(|e| invalid(format!("{label}: {e}")));

        let draft_raw: Value =
            serde_json::from_str(&text("draft.json")?.ok_or_else(|| invalid("missing draft.json".into()))?)
                .map_err(|e| invalid(format!("draft.json: {e}")))?;
        let draft = parse_spec("draft.json", draft_raw)?;

        let versions = match text("versions.json")? {
            None => Vec::new(),
            Some(s) => serde_json::from_str::<Vec<RawVersion>>(&s)
                .map_err(|e| invalid(format!("versions.json: {e}")))?
                .into_iter()
                .map(|v| {
                    Ok(ArchivedVersion {
                        label: v.label,
                        created_by: v.created_by,
                        created_at: v.created_at,
                        spec: parse_spec("versions.json", v.spec)?,
                    })
                })
                .collect::<Result<_, ArchiveError>>()?,
        };
        let notes = match text("notes.json")? {
            None => Vec::new(),
            Some(s) => serde_json::from_str(&s).map_err(|e| invalid(format!("notes.json: {e}")))?,
        };
        let thumbnail = match zip.by_name("thumbnail.png") {
            Ok(mut f) => {
                let mut bytes = Vec::new();
                f.read_to_end(&mut bytes)?;
                Some(bytes)
            }
            Err(zip::result::ZipError::FileNotFound) => None,
            Err(e) => return Err(e.into()),
        };

        Ok(Self {
            name: manifest.name,
            draft,
            versions,
            notes,
            thumbnail,
        })
    }
}
